import { z } from "zod";
import { FileStore } from "@app/db";
import { EvalContext } from "../sandbox/sandbox";
import { getEnv } from "../env";
import { fileUtils } from "@app/node";
import debug from "debug";
import { AuthError, LogicError, NetworkError, PermissionError, InternalError, classifyHttpError, isClassifiedError, formatUsageForEvent } from "../errors";
import { defineReadOnlyTool, Tool } from "./types";

const debugAudioExplain = debug("AudioExplain");

const inputSchema = z.object({
  file_path: z
    .string()
    .min(1)
    .describe("File path of the audio file to analyze"),
  prompt: z
    .string()
    .min(1)
    .max(2000)
    .describe(
      "Question or prompt about the audio - what you want to know or understand about the audio content"
    ),
});

const outputSchema = z.object({
  explanation: z
    .string()
    .describe(
      "AI-generated textual explanation or transcription of the audio"
    ),
  file_info: z
    .object({
      id: z.string().describe("File ID"),
      name: z.string().describe("Original filename"),
      media_type: z.string().describe("MIME type of the audio file"),
      size: z.number().describe("File size in bytes"),
    })
    .describe("Information about the analyzed audio file"),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

/**
 * Create the Audio.explain tool.
 * This is a read-only tool - can be used outside Items.withItem().
 */
export function makeAudioExplainTool(
  fileStore: FileStore,
  userPath: string | undefined,
  getContext: () => EvalContext
): Tool<Input, Output> {
  return defineReadOnlyTool({
    namespace: "Audio",
    name: "explain",
    description: `Analyze and explain audio files using AI.
Takes an audio file path/ID and a question about the audio, uploads the audio to an AI model and returns the textual explanation or transcription.
Supports wav, mp3, mp4, mpeg, m4a, mpga, aac, flac, webm audio formats up to 10MB.

ℹ️ Not a mutation - can be used outside Items.withItem().`,
    inputSchema,
    outputSchema,
    execute: async (input) => {
      const { file_path: file, prompt } = input;

      if (!userPath) {
        throw new PermissionError("User path not configured", { source: "Audio.explain" });
      }

      // Get environment variables
      const env = getEnv();
      if (!env.OPENROUTER_API_KEY?.trim()) {
        throw new AuthError("OpenRouter API key not configured", { source: "Audio.explain" });
      }

      const audioModel =
        env.AUDIO_MODEL || "google/gemini-2.5-flash-preview-09-2025";

      // Extract filename without extension to use as ID
      const filename = fileUtils.basename(file, fileUtils.extname(file));

      // Get file record from database
      const fileRecord = await fileStore.getFile(filename);
      if (!fileRecord) {
        throw new LogicError(`File not found with ID: ${filename}`, { source: "Audio.explain" });
      }

      // Validate that it's a supported audio format
      const supportedTypes = [
        "audio/wav",
        "audio/wave",
        "audio/x-wav",
        "audio/mp3",
        "audio/mpeg",
        "audio/mp4",
        "audio/m4a",
        "audio/aac",
        "audio/flac",
        "audio/webm",
      ];
      if (!supportedTypes.includes(fileRecord.media_type)) {
        throw new LogicError(
          `Unsupported audio format: ${fileRecord.media_type}. Supported formats: wav, mp3, mp4, mpeg, m4a, mpga, aac, flac, webm`,
          { source: "Audio.explain" }
        );
      }

      // Construct full path to actual file
      const fullPath = fileUtils.join(userPath, "files", fileRecord.path);

      // Check if file exists
      if (!fileUtils.existsSync(fullPath)) {
        throw new LogicError(`Audio file not found on disk: ${fullPath}`, { source: "Audio.explain" });
      }

      try {
        debugAudioExplain(
          `Analyzing audio ${fileRecord.name}, prompt: ${prompt}`
        );

        // Read the audio file and convert to base64
        const fd = fileUtils.openSync(fullPath, "r");
        let audioBuffer: Uint8Array;
        try {
          const stats = fileUtils.fstatSync(fd);
          const fileSize = stats.size;

          // Check file size limit (10MB)
          const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
          if (fileSize > MAX_FILE_SIZE) {
            throw new LogicError(
              `Audio file too large: ${
                Math.round((fileSize / 1024 / 1024) * 100) / 100
              }MB. Maximum allowed: 10MB`,
              { source: "Audio.explain" }
            );
          }

          audioBuffer = fileUtils.allocBuffer(fileSize);
          fileUtils.readSync(fd, audioBuffer, 0, fileSize, 0);
        } finally {
          fileUtils.closeSync(fd);
        }

        const base64Audio = fileUtils.bufferToBase64(audioBuffer);

        // Map media type to format for OpenRouter
        const getAudioFormat = (mediaType: string): string => {
          if (mediaType.includes("wav")) return "wav";
          if (
            mediaType.includes("mp3") ||
            mediaType.includes("mpeg") ||
            mediaType.includes("mpga")
          )
            return "mp3";
          if (mediaType.includes("mp4") || mediaType.includes("m4a"))
            return "mp4";
          if (mediaType.includes("aac")) return "aac";
          if (mediaType.includes("flac")) return "flac";
          if (mediaType.includes("webm")) return "webm";
          return "wav"; // fallback
        };

        // Call OpenRouter API for audio analysis
        const response = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: audioModel,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: prompt,
                    },
                    {
                      type: "input_audio",
                      input_audio: {
                        data: base64Audio,
                        format: getAudioFormat(fileRecord.media_type),
                      },
                    },
                  ],
                },
              ],
              usage: {
                include: true,
              },
            }),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw classifyHttpError(
            response.status,
            `OpenRouter API error: ${response.status} - ${errorText}`,
            { source: "Audio.explain" }
          );
        }

        const result = await response.json();

        if (!result.choices || result.choices.length === 0) {
          throw new NetworkError("No response generated by the model", { source: "Audio.explain" });
        }

        const usage = result.usage || {};
        const message = result.choices[0].message;
        if (!message.content) {
          throw new LogicError("No content found in the response", { source: "Audio.explain" });
        }

        // Extract text content from the response
        let explanation = "";
        if (typeof message.content === "string") {
          explanation = message.content;
        } else if (Array.isArray(message.content)) {
          // Concatenate text parts
          explanation = message.content
            .filter((part: any) => part.type === "text")
            .map((part: any) => part.text)
            .join("");
        } else {
          throw new LogicError("Unexpected content format in response", { source: "Audio.explain" });
        }

        debugAudioExplain("Audio analysis completed", {
          explanation: explanation.substring(0, 100) + "...",
        }, "usage", usage);

        // Create event for tracking
        await getContext().createEvent("audio_explain", {
          file: fileRecord.name,
          prompt,
          explanation:
            explanation.substring(0, 200) +
            (explanation.length > 200 ? "..." : ""),
          ...formatUsageForEvent(usage),
        });

        return {
          explanation,
          file_info: {
            id: fileRecord.id,
            name: fileRecord.name,
            media_type: fileRecord.media_type,
            size: fileRecord.size,
          },
        };
      } catch (error) {
        // Re-throw if already classified
        if (isClassifiedError(error)) {
          throw error;
        }
        throw new InternalError(error instanceof Error ? error.message : String(error), { cause: error instanceof Error ? error : undefined, source: "Audio.explain" });
      }
    },
  }) as Tool<Input, Output>;
}

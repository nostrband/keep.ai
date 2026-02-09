import { JSONSchema } from "../json-schema";
import { FileStore } from "@app/db";
import { EvalContext } from "../sandbox/sandbox";
import { getEnv } from "../env";
import { fileUtils } from "@app/node";
import debug from "debug";
import { AuthError, LogicError, NetworkError, PermissionError, InternalError, classifyHttpError, isClassifiedError, formatUsageForEvent } from "../errors";
import { defineReadOnlyTool, Tool } from "./types";

const debugImgExplain = debug("ImagesExplain");

const inputSchema: JSONSchema = {
  type: "object",
  properties: {
    file_path: {
      type: "string",
      minLength: 1,
      description: "File path of the image to analyze",
    },
    question: {
      type: "string",
      minLength: 1,
      maxLength: 2000,
      description:
        "Question or prompt about the image - what you want to know or understand about the image",
    },
  },
  required: ["file_path", "question"],
};

const outputSchema: JSONSchema = {
  type: "object",
  properties: {
    explanation: {
      type: "string",
      description: "AI-generated textual explanation or analysis of the image",
    },
    file_info: {
      type: "object",
      properties: {
        id: { type: "string", description: "File ID" },
        name: { type: "string", description: "Original filename" },
        media_type: { type: "string", description: "MIME type of the image" },
        size: { type: "number", description: "File size in bytes" },
      },
      required: ["id", "name", "media_type", "size"],
      description: "Information about the analyzed image file",
    },
  },
  required: ["explanation", "file_info"],
};

interface Input {
  file_path: string;
  question: string;
}

interface Output {
  explanation: string;
  file_info: {
    id: string;
    name: string;
    media_type: string;
    size: number;
  };
}

/**
 * Create the Images.explain tool.
 * This is a read-only tool - can be used outside Items.withItem().
 */
export function makeImagesExplainTool(
  fileStore: FileStore,
  userPath: string | undefined,
  getContext: () => EvalContext
): Tool<Input, Output> {
  return defineReadOnlyTool({
    namespace: "Images",
    name: "explain",
    description: `Analyze and explain images using AI vision model.
Takes an image file path/ID and a question about the image, uploads the image to an AI vision model and returns the textual explanation.
Supports png, jpeg, webp and gif image formats.

ℹ️ Not a mutation - can be used outside Items.withItem().`,
    inputSchema,
    outputSchema,
    execute: async (input) => {
      const { file_path: file, question } = input;

      if (!userPath) {
        throw new PermissionError("User path not configured", { source: "Images.explain" });
      }

      // Get environment variables
      const env = getEnv();
      if (!env.OPENROUTER_API_KEY?.trim()) {
        throw new AuthError("OpenRouter API key not configured", { source: "Images.explain" });
      }

      const imageModel = env.IMAGE_MODEL || "google/gemini-3-pro-image-preview";

      // Extract filename without extension to use as ID
      const filename = fileUtils.basename(file, fileUtils.extname(file));

      // Get file record from database
      const fileRecord = await fileStore.getFile(filename);
      if (!fileRecord) {
        throw new LogicError(`File not found with ID: ${filename}`, { source: "Images.explain" });
      }

      // Validate that it's a supported image format
      const supportedTypes = [
        "image/png",
        "image/jpeg",
        "image/jpg",
        "image/webp",
        "image/gif",
      ];
      if (!supportedTypes.includes(fileRecord.media_type)) {
        throw new LogicError(
          `Unsupported image format: ${
            fileRecord.media_type
          }. Supported formats: ${supportedTypes.join(", ")}`,
          { source: "Images.explain" }
        );
      }

      // Construct full path to actual file
      const fullPath = fileUtils.join(userPath, "files", fileRecord.path);

      // Check if file exists
      if (!fileUtils.existsSync(fullPath)) {
        throw new LogicError(`Image file not found on disk: ${fullPath}`, { source: "Images.explain" });
      }

      try {
        debugImgExplain(
          `Analyzing image ${fileRecord.name}, question: ${question}`
        );

        // Read the image file and convert to base64
        const fd = fileUtils.openSync(fullPath, "r");
        let imageBuffer: Uint8Array;
        try {
          const stats = fileUtils.fstatSync(fd);
          const fileSize = stats.size;
          imageBuffer = fileUtils.allocBuffer(fileSize);
          fileUtils.readSync(fd, imageBuffer, 0, fileSize, 0);
        } finally {
          fileUtils.closeSync(fd);
        }

        const base64Image = `data:${
          fileRecord.media_type
        };base64,${fileUtils.bufferToBase64(imageBuffer)}`;

        // Call OpenRouter API for image analysis
        const response = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: imageModel,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: question,
                    },
                    {
                      type: "image_url",
                      image_url: {
                        url: base64Image,
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
            { source: "Images.explain" }
          );
        }

        const result = await response.json();

        if (!result.choices || result.choices.length === 0) {
          throw new NetworkError("No response generated by the model", { source: "Images.explain" });
        }

        const usage = result.usage || {};
        const message = result.choices[0].message;
        if (!message.content) {
          throw new LogicError("No content found in the response", { source: "Images.explain" });
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
          throw new LogicError("Unexpected content format in response", { source: "Images.explain" });
        }

        debugImgExplain(
          "Image analysis completed",
          { explanation: explanation.substring(0, 100) + "..." },
          "usage",
          usage
        );

        // Create event for tracking
        await getContext().createEvent("images_explain", {
          file: fileRecord.name,
          question,
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
        throw new InternalError(error instanceof Error ? error.message : String(error), { cause: error instanceof Error ? error : undefined, source: "Images.explain" });
      }
    },
  }) as Tool<Input, Output>;
}

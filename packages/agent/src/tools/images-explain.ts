import { z } from "zod";
import { tool } from "ai";
import { FileStore } from "@app/db";
import { EvalContext } from "../sandbox/sandbox";
import { getEnv } from "../env";
import { fileUtils } from "@app/node";
import debug from "debug";

const debugImgExplain = debug("ImagesExplain");

export function makeImagesExplainTool(
  fileStore: FileStore,
  userPath: string | undefined,
  getContext: () => EvalContext
) {
  return tool({
    description: `Analyze and explain images using AI vision model.
Takes an image file path/ID and a question about the image, uploads the image to an AI vision model and returns the textual explanation.
Supports png, jpeg, webp and gif image formats.`,
    inputSchema: z.object({
      file_path: z
        .string()
        .min(1)
        .describe("File path of the image to analyze"),
      question: z
        .string()
        .min(1)
        .max(2000)
        .describe(
          "Question or prompt about the image - what you want to know or understand about the image"
        ),
    }),
    outputSchema: z.object({
      explanation: z
        .string()
        .describe("AI-generated textual explanation or analysis of the image"),
      file_info: z
        .object({
          id: z.string().describe("File ID"),
          name: z.string().describe("Original filename"),
          media_type: z.string().describe("MIME type of the image"),
          size: z.number().describe("File size in bytes"),
        })
        .describe("Information about the analyzed image file"),
    }),
    execute: async (input) => {
      const { file_path: file, question } = input;

      if (!userPath) {
        throw new Error("User path not configured");
      }

      // Get environment variables
      const env = getEnv();
      if (!env.OPENROUTER_API_KEY?.trim()) {
        throw new Error("OpenRouter API key not configured");
      }

      const imageModel = env.IMAGE_MODEL || "google/gemini-3-pro-image-preview";

      // Extract filename without extension to use as ID
      const filename = fileUtils.basename(file, fileUtils.extname(file));

      // Get file record from database
      const fileRecord = await fileStore.getFile(filename);
      if (!fileRecord) {
        throw new Error(`File not found with ID: ${filename}`);
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
        throw new Error(
          `Unsupported image format: ${
            fileRecord.media_type
          }. Supported formats: ${supportedTypes.join(", ")}`
        );
      }

      // Construct full path to actual file
      const fullPath = fileUtils.join(userPath, "files", fileRecord.path);

      // Check if file exists
      if (!fileUtils.existsSync(fullPath)) {
        throw new Error(`Image file not found on disk: ${fullPath}`);
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
          throw new Error(
            `OpenRouter API error: ${response.status} - ${errorText}`
          );
        }

        const result = await response.json();

        if (!result.choices || result.choices.length === 0) {
          throw new Error("No response generated by the model");
        }

        const usage = result.usage || {};
        const message = result.choices[0].message;
        if (!message.content) {
          throw new Error("No content found in the response");
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
          throw new Error("Unexpected content format in response");
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
          usage: { cost: usage.cost },
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
        throw new Error(
          `Image analysis failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    },
  });
}

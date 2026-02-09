import { JSONSchema } from "../json-schema";
import { FileStore, type File } from "@app/db";
import { EvalContext } from "../sandbox/sandbox";
import { getEnv } from "../env";
import { createHash } from "crypto";
import { fileUtils } from "@app/node";
import { detectBufferMime, mimeToExt } from "@app/node";
import fs from "fs";
import debug from "debug";
import { AuthError, LogicError, NetworkError, PermissionError, InternalError, classifyHttpError, isClassifiedError, formatUsageForEvent } from "../errors";
import { defineTool, Tool } from "./types";

const debugImg = debug("ImagesGenerate");

const inputSchema: JSONSchema = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      minLength: 1,
      maxLength: 1000,
      description: "Textual description of the image to generate",
    },
    file_prefix: {
      type: "string",
      minLength: 1,
      maxLength: 50,
      description:
        "Prefix to use for the filename of generated images, no spaces, filename-suitable symbols only",
    },
    aspect_ratio: {
      type: "string",
      description:
        "Aspect ratio for the image (e.g., '16:9', '1:1', '4:3'). Defaults to '1:1' if not specified",
    },
  },
  required: ["prompt", "file_prefix"],
};

const outputSchema: JSONSchema = {
  type: "object",
  properties: {
    images: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "File ID of the generated image" },
          name: { type: "string", description: "Filename of the generated image" },
          path: { type: "string", description: "Local file path" },
          size: { type: "number", description: "File size in bytes" },
          media_type: { type: "string", description: "MIME type of the image" },
          summary: { type: "string", description: "Summary/description of the image" },
          upload_time: { type: "string", description: "Generation timestamp" },
        },
        required: ["id", "name", "path", "size", "media_type", "summary", "upload_time"],
      },
      description: "Array of generated image file records",
    },
    reasoning: {
      type: "string",
      description: "Image model's reasoning",
    },
  },
  required: ["images", "reasoning"],
};

interface Input {
  prompt: string;
  file_prefix: string;
  aspect_ratio?: string | null;
}

interface Output {
  images: {
    id: string;
    name: string;
    path: string;
    size: number;
    media_type: string;
    summary: string;
    upload_time: string;
  }[];
  reasoning: string;
}

/**
 * Create the Images.generate tool.
 * This is a mutation (creates files) - must be called inside Items.withItem().
 */
export function makeImagesGenerateTool(
  fileStore: FileStore,
  userPath: string | undefined,
  getContext: () => EvalContext
): Tool<Input, Output> {
  return defineTool({
    namespace: "Images",
    name: "generate",
    description: `Generate images using AI image generation model.
Takes a textual prompt describing the desired image and an optional aspect ratio.
Generates images and saves them to files. Returns information about the generated image files.

⚠️ MUTATION - must be called inside Items.withItem().`,
    inputSchema,
    outputSchema,
    isReadOnly: () => false,
    execute: async (input) => {
      const { prompt, file_prefix, aspect_ratio = "1:1" } = input;

      if (!userPath) {
        throw new PermissionError("User path not configured", { source: "Images.generate" });
      }

      // Get environment variables
      const env = getEnv();
      if (!env.OPENROUTER_API_KEY?.trim()) {
        throw new AuthError("OpenRouter API key not configured", { source: "Images.generate" });
      }

      const imageModel = env.IMAGE_MODEL || "google/gemini-3-pro-image-preview";

      try {
        debugImg(`Generating image ${aspect_ratio}, prompt: ${prompt}`);
        // Call OpenRouter API for image generation
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
                  content: prompt,
                },
              ],
              modalities: ["image", "text"],
              image_config: {
                aspect_ratio: aspect_ratio,
              },
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
            { source: "Images.generate" }
          );
        }

        const result = await response.json();

        if (!result.choices || result.choices.length === 0) {
          throw new NetworkError("No image generated by the model", { source: "Images.generate" });
        }

        const usage = result.usage || {};
        const message = result.choices[0].message;
        const reasoning: string = message.reasoning;
        debugImg("Generated images reasoning", reasoning, "usage", usage);

        if (!message.images || message.images.length === 0) {
          throw new LogicError("No images found in the response", { source: "Images.generate" });
        }
        debugImg("Generated images", message.images);

        const generatedFiles: File[] = [];

        // Process each generated image
        for (let index = 0; index < message.images.length; index++) {
          const image = message.images[index];
          const imageUrl = image.image_url.url;

          // Download the image from the URL
          const imageResponse = await fetch(imageUrl);
          if (!imageResponse.ok) {
            throw classifyHttpError(
              imageResponse.status,
              `Failed to download image ${index + 1}: ${imageResponse.status}`,
              { source: "Images.generate" }
            );
          }

          const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

          // Calculate SHA256 hash as ID
          const hash = createHash("sha256");
          hash.update(imageBuffer);
          const fileId = hash.digest("hex");

          // Check if file already exists (unlikely for generated images, but good practice)
          const existingFile = await fileStore.getFile(fileId);
          if (existingFile) {
            generatedFiles.push(existingFile);
            continue;
          }

          // Detect media type
          let mediaType = await detectBufferMime(imageBuffer);
          if (!mediaType) {
            // Default to PNG for generated images
            mediaType = "image/png";
          }

          // Get file extension
          const extension = mimeToExt(mediaType) || "png";

          // Generate filename
          const timestamp = new Date().toISOString().replace(/[:.T]/g, "-");
          const filename = `${file_prefix}-${timestamp}-${
            index + 1
          }.${extension}`;

          // Ensure files directory exists
          const filesDir = fileUtils.join(userPath, "files");
          if (!fileUtils.existsSync(filesDir)) {
            fs.mkdirSync(filesDir, { recursive: true });
          }

          // Create local file path
          const fileNameLocal = `${fileId}.${extension}`;
          const filePathLocal = fileUtils.join(filesDir, fileNameLocal);

          // Write file to disk
          fs.writeFileSync(filePathLocal, imageBuffer);

          // Create summary with prompt
          const summary = `Generated by user request, prompt: ${prompt}`;

          // Create file record
          const fileRecord: File = {
            id: fileId,
            name: filename,
            path: fileNameLocal,
            size: imageBuffer.length,
            summary: summary,
            upload_time: new Date().toISOString(),
            media_type: mediaType,
          };

          // Insert file to database
          await fileStore.insertFile(fileRecord);
          generatedFiles.push(fileRecord);
        }

        // Create event for tracking
        await getContext().createEvent("images_generate", {
          prompt,
          aspect_ratio,
          count: generatedFiles.length,
          files: generatedFiles.map((f) => f.path),
          ...formatUsageForEvent(usage),
        });

        return {
          images: generatedFiles,
          reasoning,
        };
      } catch (error) {
        // Re-throw if already classified
        if (isClassifiedError(error)) {
          throw error;
        }
        throw new InternalError(error instanceof Error ? error.message : String(error), { cause: error instanceof Error ? error : undefined, source: "Images.generate" });
      }
    },
  }) as Tool<Input, Output>;
}

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

const debugImgTransform = debug("ImagesTransform");

const inputSchema: JSONSchema = {
  type: "object",
  properties: {
    file_paths: {
      type: "array",
      items: { type: "string", minLength: 1 },
      minItems: 1,
      maxItems: 5,
      description:
        "Array of file paths of the input images to transform (1-5 images) - filename (without extension) will be used as ID to look up in database",
    },
    prompt: {
      type: "string",
      minLength: 1,
      maxLength: 1000,
      description:
        "Textual description of the desired transformation or modification to apply to the image",
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
        "Aspect ratio for the generated image (e.g., '16:9', '1:1', '4:3'). Defaults to '1:1' if not specified",
    },
  },
  required: ["file_paths", "prompt", "file_prefix"],
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
    source_files: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "Source file ID" },
          name: { type: "string", description: "Source filename" },
          media_type: { type: "string", description: "Source MIME type" },
          size: { type: "number", description: "Source file size in bytes" },
        },
        required: ["id", "name", "media_type", "size"],
      },
      description: "Information about the source image files",
    },
    reasoning: {
      type: "string",
      description: "Image model's reasoning",
    },
  },
  required: ["images", "source_files", "reasoning"],
};

interface Input {
  file_paths: string[];
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
  source_files: {
    id: string;
    name: string;
    media_type: string;
    size: number;
  }[];
  reasoning: string;
}

/**
 * Create the Images.transform tool.
 */
export function makeImagesTransformTool(
  fileStore: FileStore,
  userPath: string | undefined,
  getContext: () => EvalContext
): Tool<Input, Output> {
  return defineTool({
    namespace: "Images",
    name: "transform",
    description: `Transform/modify images using AI image generation model based on one or more input images.
Takes existing image files (up to 5) and a textual prompt describing the desired transformation, then generates new images based on the inputs.
Supports png, jpeg, webp and gif input formats. Returns information about the generated image files.`,
    inputSchema,
    outputSchema,
    isReadOnly: () => false,
    execute: async (input) => {
      const {
        file_paths: filePaths,
        prompt,
        file_prefix,
        aspect_ratio = "1:1",
      } = input;

      if (!userPath) {
        throw new PermissionError("User path not configured", { source: "Images.transform" });
      }

      // Get environment variables
      const env = getEnv();
      if (!env.OPENROUTER_API_KEY?.trim()) {
        throw new AuthError("OpenRouter API key not configured", { source: "Images.transform" });
      }

      const imageModel = env.IMAGE_MODEL || "google/gemini-3-pro-image-preview";

      const supportedTypes = [
        "image/png",
        "image/jpeg",
        "image/jpg",
        "image/webp",
        "image/gif",
      ];

      // Process all source images
      const sourceFileRecords: File[] = [];
      const base64Images: string[] = [];

      for (const file of filePaths) {
        // Extract filename without extension to use as ID
        const filename = fileUtils.basename(file, fileUtils.extname(file));

        // Get file record from database
        const fileRecord = await fileStore.getFile(filename);
        if (!fileRecord) {
          throw new LogicError(`File not found with ID: ${filename}`, { source: "Images.transform" });
        }

        // Validate that it's a supported image format
        if (!supportedTypes.includes(fileRecord.media_type)) {
          throw new LogicError(
            `Unsupported image format for ${fileRecord.name}: ${
              fileRecord.media_type
            }. Supported formats: ${supportedTypes.join(", ")}`,
            { source: "Images.transform" }
          );
        }

        // Construct full path to actual file
        const fullPath = fileUtils.join(userPath, "files", fileRecord.path);

        // Check if file exists
        if (!fileUtils.existsSync(fullPath)) {
          throw new LogicError(`Source image file not found on disk: ${fullPath}`, { source: "Images.transform" });
        }

        // Read the source image file and convert to base64
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

        sourceFileRecords.push(fileRecord);
        base64Images.push(base64Image);
      }

      try {
        debugImgTransform(
          `Transforming ${sourceFileRecords.length} image(s) with aspect ratio ${aspect_ratio}, prompt: ${prompt}`
        );

        // Build content array with text prompt and all images
        const contentArray: any[] = [
          {
            type: "text",
            text: prompt,
          },
        ];

        // Add all source images to the content
        for (const base64Image of base64Images) {
          contentArray.push({
            type: "image_url",
            image_url: {
              url: base64Image,
            },
          });
        }

        // Call OpenRouter API for image transformation/generation
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
                  content: contentArray,
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
            { source: "Images.transform" }
          );
        }

        const result = await response.json();

        if (!result.choices || result.choices.length === 0) {
          throw new NetworkError("No image generated by the model", { source: "Images.transform" });
        }

        const usage = result.usage || {};
        const message = result.choices[0].message;
        const reasoning: string = message.reasoning;
        debugImgTransform(
          "Generated images reasoning",
          reasoning,
          "usage",
          usage
        );

        if (!message.images || message.images.length === 0) {
          throw new LogicError("No images found in the response", { source: "Images.transform" });
        }
        debugImgTransform("Generated images", message.images);

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
              { source: "Images.transform" }
            );
          }

          const generatedImageBuffer = Buffer.from(
            await imageResponse.arrayBuffer()
          );

          // Calculate SHA256 hash as ID
          const hash = createHash("sha256");
          hash.update(generatedImageBuffer);
          const fileId = hash.digest("hex");

          // Check if file already exists (unlikely for generated images, but good practice)
          const existingFile = await fileStore.getFile(fileId);
          if (existingFile) {
            generatedFiles.push(existingFile);
            continue;
          }

          // Detect media type
          let mediaType = await detectBufferMime(generatedImageBuffer);
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
          fs.writeFileSync(filePathLocal, generatedImageBuffer);

          // Create summary with prompt and source info
          const sourceNames = sourceFileRecords.map((f) => f.name).join(", ");
          const summary = `Transformed from ${sourceNames}, prompt: ${prompt}`;

          // Create file record
          const generatedFileRecord: File = {
            id: fileId,
            name: filename,
            path: fileNameLocal,
            size: generatedImageBuffer.length,
            summary: summary,
            upload_time: new Date().toISOString(),
            media_type: mediaType,
          };

          // Insert file to database
          await fileStore.insertFile(generatedFileRecord);
          generatedFiles.push(generatedFileRecord);
        }

        // Create event for tracking
        await getContext().createEvent("images_transform", {
          source_files: sourceFileRecords.map((f) => f.name),
          prompt,
          aspect_ratio,
          count: generatedFiles.length,
          files: generatedFiles.map((f) => f.path),
          ...formatUsageForEvent(usage),
        });

        return {
          images: generatedFiles,
          source_files: sourceFileRecords.map((f) => ({
            id: f.id,
            name: f.name,
            media_type: f.media_type,
            size: f.size,
          })),
          reasoning,
        };
      } catch (error) {
        // Re-throw if already classified
        if (isClassifiedError(error)) {
          throw error;
        }
        throw new InternalError(error instanceof Error ? error.message : String(error), { cause: error instanceof Error ? error : undefined, source: "Images.transform" });
      }
    },
  }) as Tool<Input, Output>;
}

import { z } from "zod";
import { tool } from "ai";
import { FileStore, type File } from "@app/db";
import { EvalContext } from "../sandbox/sandbox";
import { getEnv } from "../env";
import { createHash } from "crypto";
import { fileUtils } from "@app/node";
import { detectBufferMime, mimeToExt } from "@app/node";
import fs from "fs";
import debug from "debug";

const debugImgTransform = debug("ImagesTransform");

export function makeImagesTransformTool(
  fileStore: FileStore,
  userPath: string | undefined,
  getContext: () => EvalContext
) {
  return tool({
    description: `Transform/modify images using AI image generation model based on one or more input images.
Takes existing image files (up to 5) and a textual prompt describing the desired transformation, then generates new images based on the inputs.
Supports png, jpeg, webp and gif input formats. Returns information about the generated image files.`,
    inputSchema: z.object({
      file_paths: z
        .array(z.string().min(1))
        .min(1)
        .max(5)
        .describe(
          "Array of file paths of the input images to transform (1-5 images) - filename (without extension) will be used as ID to look up in database"
        ),
      prompt: z
        .string()
        .min(1)
        .max(1000)
        .describe(
          "Textual description of the desired transformation or modification to apply to the image"
        ),
      file_prefix: z
        .string()
        .min(1)
        .max(50)
        .describe(
          "Prefix to use for the filename of generated images, no spaces, filename-suitable symbols only"
        ),
      aspect_ratio: z
        .string()
        .optional()
        .nullable()
        .describe(
          "Aspect ratio for the generated image (e.g., '16:9', '1:1', '4:3'). Defaults to '1:1' if not specified"
        ),
    }),
    outputSchema: z.object({
      images: z
        .array(
          z.object({
            id: z.string().describe("File ID of the generated image"),
            name: z.string().describe("Filename of the generated image"),
            path: z.string().describe("Local file path"),
            size: z.number().describe("File size in bytes"),
            media_type: z.string().describe("MIME type of the image"),
            summary: z.string().describe("Summary/description of the image"),
            upload_time: z.string().describe("Generation timestamp"),
          })
        )
        .describe("Array of generated image file records"),
      source_files: z
        .array(
          z.object({
            id: z.string().describe("Source file ID"),
            name: z.string().describe("Source filename"),
            media_type: z.string().describe("Source MIME type"),
            size: z.number().describe("Source file size in bytes"),
          })
        )
        .describe("Information about the source image files"),
      reasoning: z.string().describe("Image model's reasoning"),
    }),
    execute: async (input) => {
      const {
        file_paths: filePaths,
        prompt,
        file_prefix,
        aspect_ratio = "1:1",
      } = input;

      if (!userPath) {
        throw new Error("User path not configured");
      }

      // Get environment variables
      const env = getEnv();
      if (!env.OPENROUTER_API_KEY?.trim()) {
        throw new Error("OpenRouter API key not configured");
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
          throw new Error(`File not found with ID: ${filename}`);
        }

        // Validate that it's a supported image format
        if (!supportedTypes.includes(fileRecord.media_type)) {
          throw new Error(
            `Unsupported image format for ${fileRecord.name}: ${
              fileRecord.media_type
            }. Supported formats: ${supportedTypes.join(", ")}`
          );
        }

        // Construct full path to actual file
        const fullPath = fileUtils.join(userPath, "files", fileRecord.path);

        // Check if file exists
        if (!fileUtils.existsSync(fullPath)) {
          throw new Error(`Source image file not found on disk: ${fullPath}`);
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
          throw new Error("No image generated by the model");
        }

        const message = result.choices[0].message;
        const reasoning: string = message.reasoning;
        debugImgTransform("Generated images reasoning", reasoning);

        if (!message.images || message.images.length === 0) {
          throw new Error("No images found in the response");
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
            throw new Error(
              `Failed to download image ${index + 1}: ${imageResponse.status}`
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
        throw new Error(
          `Image transformation failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    },
  });
}

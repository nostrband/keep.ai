import { JSONSchema } from "../json-schema";
import { FileStore } from "@app/db";
import { EvalContext } from "../sandbox/sandbox";
import { getEnv } from "../env";
import { fileUtils } from "@app/node";
import debug from "debug";
import { AuthError, LogicError, NetworkError, PermissionError, InternalError, classifyHttpError, isClassifiedError, formatUsageForEvent } from "../errors";
import { defineReadOnlyTool, Tool } from "./types";

const debugPdfExplain = debug("PdfExplain");

const inputSchema: JSONSchema = {
  type: "object",
  properties: {
    file_path: {
      type: "string",
      minLength: 1,
      description: "File path of the PDF to analyze",
    },
    prompt: {
      type: "string",
      minLength: 1,
      maxLength: 2000,
      description:
        "Question or prompt about the PDF - what you want to know or understand about the document",
    },
  },
  required: ["file_path", "prompt"],
};

const outputSchema: JSONSchema = {
  type: "object",
  properties: {
    explanation: {
      type: "string",
      description: "AI-generated textual explanation or analysis of the PDF",
    },
    file_info: {
      type: "object",
      properties: {
        id: { type: "string", description: "File ID" },
        name: { type: "string", description: "Original filename" },
        size: { type: "number", description: "File size in bytes" },
      },
      required: ["id", "name", "size"],
      description: "Information about the analyzed PDF file",
    },
  },
  required: ["explanation", "file_info"],
};

interface Input {
  file_path: string;
  prompt: string;
}

interface Output {
  explanation: string;
  file_info: {
    id: string;
    name: string;
    size: number;
  };
}

/**
 * Create the Pdf.explain tool.
 * This is a read-only tool - can be used outside Items.withItem().
 */
export function makePdfExplainTool(
  fileStore: FileStore,
  userPath: string | undefined,
  getContext: () => EvalContext
): Tool<Input, Output> {
  return defineReadOnlyTool({
    namespace: "Pdf",
    name: "explain",
    description: `Analyze and explain PDF documents using AI.
Takes a PDF file path/ID and a question about the document, uploads the PDF to an AI model and returns the textual explanation.

ℹ️ Not a mutation - can be used outside Items.withItem().`,
    inputSchema,
    outputSchema,
    execute: async (input) => {
      const { file_path: file, prompt } = input;

      if (!userPath) {
        throw new PermissionError("User path not configured", { source: "Pdf.explain" });
      }

      // Get environment variables
      const env = getEnv();
      if (!env.OPENROUTER_API_KEY?.trim()) {
        throw new AuthError("OpenRouter API key not configured", { source: "Pdf.explain" });
      }

      const pdfModel = env.PDF_MODEL || "openai/gpt-oss-120b";

      // Extract filename without extension to use as ID
      const filename = fileUtils.basename(file, fileUtils.extname(file));

      // Get file record from database
      const fileRecord = await fileStore.getFile(filename);
      if (!fileRecord) {
        throw new LogicError(`File not found with ID: ${filename}`, { source: "Pdf.explain" });
      }

      // Validate that it's a PDF format
      const supportedTypes = ["application/pdf"];
      if (!supportedTypes.includes(fileRecord.media_type)) {
        throw new LogicError(
          `Unsupported file format: ${
            fileRecord.media_type
          }. Supported formats: ${supportedTypes.join(", ")}`,
          { source: "Pdf.explain" }
        );
      }

      // Construct full path to actual file
      const fullPath = fileUtils.join(userPath, "files", fileRecord.path);

      // Check if file exists
      if (!fileUtils.existsSync(fullPath)) {
        throw new LogicError(`PDF file not found on disk: ${fullPath}`, { source: "Pdf.explain" });
      }

      try {
        debugPdfExplain(`Analyzing PDF ${fileRecord.name}, prompt: ${prompt}`);

        // Read the PDF file and convert to base64
        const fd = fileUtils.openSync(fullPath, "r");
        let pdfBuffer: Uint8Array;
        try {
          const stats = fileUtils.fstatSync(fd);
          const fileSize = stats.size;

          // Check file size limit (10MB)
          const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
          if (fileSize > MAX_FILE_SIZE) {
            throw new LogicError(
              `PDF file too large: ${
                Math.round((fileSize / 1024 / 1024) * 100) / 100
              }MB. Maximum allowed: 10MB`,
              { source: "Pdf.explain" }
            );
          }

          pdfBuffer = fileUtils.allocBuffer(fileSize);
          fileUtils.readSync(fd, pdfBuffer, 0, fileSize, 0);
        } finally {
          fileUtils.closeSync(fd);
        }

        const base64PDF = `data:application/pdf;base64,${fileUtils.bufferToBase64(
          pdfBuffer
        )}`;

        // Call OpenRouter API for PDF analysis
        const response = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: pdfModel,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: prompt,
                    },
                    {
                      type: "file",
                      file: {
                        filename: fileRecord.name,
                        file_data: base64PDF,
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
            { source: "Pdf.explain" }
          );
        }

        const result = await response.json();

        if (!result.choices || result.choices.length === 0) {
          throw new NetworkError("No response generated by the model", { source: "Pdf.explain" });
        }

        const usage = result.usage || {};
        const message = result.choices[0].message;
        if (!message.content) {
          throw new LogicError("No content found in the response", { source: "Pdf.explain" });
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
          throw new LogicError("Unexpected content format in response", { source: "Pdf.explain" });
        }

        debugPdfExplain(
          "PDF analysis completed",
          { explanation: explanation.substring(0, 100) + "..." },
          "usage",
          usage
        );

        // Create event for tracking
        await getContext().createEvent("pdf_explain", {
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
            size: fileRecord.size,
          },
        };
      } catch (error) {
        // Re-throw if already classified
        if (isClassifiedError(error)) {
          throw error;
        }
        throw new InternalError(error instanceof Error ? error.message : String(error), { cause: error instanceof Error ? error : undefined, source: "Pdf.explain" });
      }
    },
  }) as Tool<Input, Output>;
}

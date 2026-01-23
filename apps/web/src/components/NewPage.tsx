import React, { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import SharedHeader from "./SharedHeader";
import { useDbQuery } from "../hooks/dbQuery";
import { useFileUpload } from "../hooks/useFileUpload";
import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "../ui";
import { PlusIcon } from "lucide-react";
import type { FileUIPart } from "ai";
import { type File as DbFile } from "@app/db";

type PromptInputMessage = {
  text?: string;
  files?: FileUIPart[];
};

export default function NewPage() {
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const { api } = useDbQuery();
  const { uploadFiles, uploadState } = useFileUpload();

  const handleSubmit = useCallback(async (message: PromptInputMessage) => {
    const hasText = Boolean(message.text);
    const hasAttachments = Boolean(message.files?.length);

    if (!(hasText || hasAttachments) || !api) {
      return;
    }

    setIsSubmitting(true);

    try {
      const messageContent = message.text || "";
      let attachedFiles: DbFile[] = [];

      // Upload files if any are attached
      if (hasAttachments && message.files) {
        try {
          // Convert FileUIPart[] to File[] by fetching blob URLs
          const files: File[] = [];
          for (const fileUIPart of message.files) {
            if (fileUIPart.url) {
              const response = await fetch(fileUIPart.url);
              const blob = await response.blob();
              const file = new File([blob], fileUIPart.filename || 'unknown', {
                type: fileUIPart.mediaType || 'application/octet-stream'
              });
              files.push(file);
            }
          }

          // Upload the files
          const uploadResults = await uploadFiles(files);

          // Collect file paths for the message parts
          attachedFiles = uploadResults;
        } catch (error) {
          console.error('File upload failed:', error);
          // Still send the message without file attachments
        }
      }

      // Call api.createTask
      const result = await api.createTask({
        content: messageContent,
        files: attachedFiles,
      });

      // Redirect to /chats/<id>
      navigate(`/chats/${result.chatId}`);
    } catch (error) {
      console.error('Failed to create task:', error);
      setIsSubmitting(false);
    }
  }, [api, navigate, uploadFiles]);

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader title="New Chat" />
      
      {/* Centered prompt input */}
      <div className="flex items-center justify-center min-h-[calc(100vh-80px)] px-6">
        <div className="w-full max-w-4xl">
          {/* Upload progress indicator */}
          {uploadState.isUploading && uploadState.uploadProgress && (
            <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center justify-between text-sm text-blue-600 mb-2">
                <span>Uploading {uploadState.uploadProgress.fileName}...</span>
                <span>{Math.round(uploadState.uploadProgress.progress)}%</span>
              </div>
              <div className="w-full bg-blue-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-200"
                  style={{ width: `${uploadState.uploadProgress.progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Upload error indicator */}
          {uploadState.error && (
            <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{uploadState.error}</p>
            </div>
          )}

          <PromptInput
            onSubmit={handleSubmit}
            globalDrop
            multiple
          >
            <PromptInputBody>
              <PromptInputAttachments>
                {(attachment) => <PromptInputAttachment data={attachment} />}
              </PromptInputAttachments>
              <PromptInputTextarea
                onChange={(e) => setInput(e.target.value)}
                value={input}
                placeholder="What would you like to plan?"
              />
            </PromptInputBody>
            <PromptInputToolbar>
              <PromptInputTools>
                <PromptInputButton
                  onClick={() => {
                    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
                    fileInput?.click();
                  }}
                  aria-label="Add files"
                >
                  <PlusIcon className="size-4" />
                </PromptInputButton>
              </PromptInputTools>
              <PromptInputSubmit
                disabled={!input || uploadState.isUploading || isSubmitting}
                status={uploadState.isUploading || isSubmitting ? "submitted" : undefined}
              />
            </PromptInputToolbar>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}

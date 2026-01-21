import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import ChatInterface from "./ChatInterface";
import SharedHeader from "./SharedHeader";
import { QuickReplyButtons } from "./QuickReplyButtons";
import { useAddMessage } from "../hooks/dbWrites";
import { useFileUpload } from "../hooks/useFileUpload";
import { useTaskByChatId, useTaskState } from "../hooks/dbTaskReads";
import { parseAsks } from "@app/proto";
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

export default function ChatPage() {
  const id = "main"; // Static chat ID
  const [input, setInput] = useState("");
  const [promptHeight, setPromptHeight] = useState(0);
  const [isQuickReplySubmitting, setIsQuickReplySubmitting] = useState(false);
  const promptContainerRef = useRef<HTMLDivElement>(null);
  const addMessage = useAddMessage();
  const { uploadFiles, uploadState } = useFileUpload();

  // Get task associated with this chat for quick-reply buttons
  const { data: task } = useTaskByChatId(id);
  const { data: taskState } = useTaskState(task?.id || "");

  // Parse quick-reply options from task.asks when task is waiting
  const quickReplyOptions = useMemo(() => {
    if (!task || !taskState) return [];
    // Only show options when task is in wait or asks state
    if (task.state !== "wait" && task.state !== "asks") return [];
    if (!taskState.asks) return [];

    const parsed = parseAsks(taskState.asks);
    return parsed.options || [];
  }, [task, taskState]);

  const handleSubmit = useCallback(async (message: PromptInputMessage) => {
    const hasText = Boolean(message.text);
    const hasAttachments = Boolean(message.files?.length);

    if (!(hasText || hasAttachments)) {
      return;
    }

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
        // We could add error handling here if needed
      }
    }

    // Send the message with file paths array
    addMessage.mutate({
      chatId: id, 
      role: "user",
      content: messageContent,
      files: attachedFiles,
    });

    setInput("");
  }, [addMessage, uploadFiles]);

  // Handle quick-reply button selection
  const handleQuickReply = useCallback((option: string) => {
    // Set local state immediately to prevent double-clicks
    setIsQuickReplySubmitting(true);

    // Send the selected option as a user message
    addMessage.mutate({
      chatId: id,
      role: "user",
      content: option,
      files: [],
    }, {
      onSettled: () => {
        // Reset local state when mutation completes (success or error)
        setIsQuickReplySubmitting(false);
      }
    });
  }, [addMessage]);

  // Track prompt input height changes
  useEffect(() => {
    const container = promptContainerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setPromptHeight(entry.contentRect.height);
      }
    });

    resizeObserver.observe(container);
    
    // Set initial height
    setPromptHeight(container.getBoundingClientRect().height);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);
  
  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader title="Assistant" />
      
      {/* Main chat area - flows behind header and footer with padding */}
      <div
        className="pt-6 transition-[padding-bottom] duration-200 ease-out"
        style={{ paddingBottom: Math.max(144, promptHeight + 32) }} // extra margin
      >
        <ChatInterface chatId={id} promptHeight={promptHeight} />
      </div>
      
      {/* Fixed prompt input at viewport bottom */}
      <div className="fixed bottom-0 left-0 right-0 z-10 bg-gray-50 border-t border-gray-200">
        <div ref={promptContainerRef} className="max-w-4xl mx-auto px-6 py-4">
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

          {/* Quick-reply buttons when agent is waiting for user input */}
          {quickReplyOptions.length > 0 && (
            <QuickReplyButtons
              options={quickReplyOptions}
              onSelect={handleQuickReply}
              disabled={addMessage.isPending || isQuickReplySubmitting || uploadState.isUploading}
            />
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
                disabled={(!input && !uploadState.isUploading) || uploadState.isUploading}
                status={uploadState.isUploading ? "submitted" : undefined}
              />
            </PromptInputToolbar>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}
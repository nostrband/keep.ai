import React, { useState, useCallback, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import ChatInterface from "./ChatInterface";
import SharedHeader from "./SharedHeader";
import { useAddMessage } from "../hooks/dbWrites";
import { useFileUpload } from "../hooks/useFileUpload";
import { useWorkflowByChatId } from "../hooks/dbScriptReads";
import { WorkflowInfoBox } from "./WorkflowInfoBox";
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

export default function ChatDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const chatId = id || "main"; // Fallback to "main" if no ID
  const [input, setInput] = useState("");
  const [promptHeight, setPromptHeight] = useState(0);
  const promptContainerRef = useRef<HTMLDivElement>(null);
  const addMessage = useAddMessage();
  const { uploadFiles, uploadState } = useFileUpload();
  const { data: workflow } = useWorkflowByChatId(chatId);

  const handleWorkflowClick = () => {
    if (workflow) {
      navigate(`/workflows/${workflow.id}`);
    }
  };

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
      }
    }

    // Send the message with file paths array
    addMessage.mutate({
      chatId, // threadId === chatId
      role: "user",
      content: messageContent,
      files: attachedFiles,
    });

    setInput("");
  }, [addMessage, uploadFiles, chatId]);

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
      <SharedHeader title="Chat" />

      {/* Workflow info box - shows which workflow this chat belongs to */}
      {workflow && (
        <div className="sticky top-[var(--header-height)] z-10 bg-gray-50 border-b border-gray-200">
          <div className="max-w-4xl mx-auto px-6 py-4">
            <WorkflowInfoBox workflow={workflow} onClick={handleWorkflowClick} />
          </div>
        </div>
      )}

      {/* Main chat area - flows behind header and footer with padding */}
      <div
        className="pt-6 transition-[padding-bottom] duration-200 ease-out"
        style={{ paddingBottom: Math.max(144, promptHeight + 32) }} // extra margin
      >
        <ChatInterface chatId={chatId} promptHeight={promptHeight} />
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
                disabled={!input || uploadState.isUploading}
                status={uploadState.isUploading ? "submitted" : undefined}
              />
            </PromptInputToolbar>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useCallback, useRef, useEffect } from "react";
import { useParams, Navigate } from "react-router-dom";
import ChatInterface from "./ChatInterface";
import SharedHeader from "./SharedHeader";
import { useAddMessage } from "../hooks/dbWrites";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "../ui";
import type { FileUIPart } from "ai";

type PromptInputMessage = {
  text?: string;
  files?: FileUIPart[];
};

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const [input, setInput] = useState("");
  const [promptHeight, setPromptHeight] = useState(0);
  const promptContainerRef = useRef<HTMLDivElement>(null);
  const addMessage = useAddMessage();
  
  // If no ID is provided or ID is "new", generate a new chat ID
  if (!id || id === "new") {
    const newId = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    return <Navigate to={`/chat/${newId}`} replace />;
  }

  const handleSubmit = useCallback((message: PromptInputMessage) => {
    const hasText = Boolean(message.text);
    const hasAttachments = Boolean(message.files?.length);

    if (!(hasText || hasAttachments)) {
      return;
    }

    addMessage.mutate({
      threadId: id, // threadId === chatId
      role: "user",
      content: message.text || "Sent with attachments",
    });

    setInput("");
  }, [id, addMessage]);

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
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger />
                  <PromptInputActionMenuContent>
                    <PromptInputActionAddAttachments />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>
              </PromptInputTools>
              <PromptInputSubmit disabled={!input} />
            </PromptInputToolbar>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}
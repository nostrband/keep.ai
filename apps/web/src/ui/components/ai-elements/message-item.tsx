"use client";

import React from "react";
import { Message, MessageContent } from "../ai-elements/message";
import { Actions, Action } from "../ai-elements/actions";
import { Response } from "../ai-elements/response";
import { RefreshCcwIcon, CopyIcon } from "lucide-react";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "../ai-elements/sources";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "../ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "../ai-elements/tool";
import { Loader } from "../ai-elements/loader";
import type { ToolUIPart } from "ai";
import { AssistantUIMessage } from "@app/proto"

interface MessageItemProps {
  message: AssistantUIMessage;
  status: "ready" | "streaming" | "submitted" | "error";
  isLastMessage: boolean;
  full?: boolean;
}

export const MessageItem = React.memo(function MessageItem({
  message,
  status,
  isLastMessage,
  full = true,
}: MessageItemProps) {
  const handleCopy = React.useCallback(() => {
    const textParts = message.parts.filter((part) => part.type === "text");
    const allText = textParts.map((part) => part.text).join("\n");
    navigator.clipboard.writeText(allText);
  }, [message.parts]);

  const sourceParts = React.useMemo(
    () => message.parts.filter((part) => part.type === "source-url"),
    [message.parts]
  );

  const textParts = React.useMemo(
    () => message.parts.filter((part) => part.type === "text"),
    [message.parts]
  );

  const showActions = React.useMemo(
    () => message.role === "assistant" && (status === "ready" || status === "error"),
    [message.role, status]
  );

  return (
    <div className={!showActions ? "pb-4" : ""}>
      {/* Sources - only show when full=true */}
      {full && message.role === "assistant" && sourceParts.length > 0 && (
        <Sources>
          <SourcesTrigger count={sourceParts.length} />
          {sourceParts.map((part, sourceIndex) => (
            <SourcesContent key={`${message.id}-${sourceIndex}`}>
              <Source
                key={`${message.id}-${sourceIndex}`}
                href={part.url}
                title={part.url}
              />
            </SourcesContent>
          ))}
        </Sources>
      )}

      {/* Message */}
      <Message from={message.role}>
        <MessageContent>
          {message.parts.map((part, partIndex) => {
            switch (part.type) {
              case "text":
                return (
                  <Response key={`${message.id}-${partIndex}`}>
                    {part.text}
                  </Response>
                );
              case "file":
                // Display file attachments
                return (
                  <div key={`${message.id}-${partIndex}`} className="mb-2">
                    <div className="inline-flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg border border-gray-200 text-sm">
                      <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                      </svg>
                      <a
                        href={`/files/get/${part.url}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        {part.filename || part.url?.split('/').pop() || 'Attached file'}
                      </a>
                    </div>
                  </div>
                );
              case "reasoning":
                // Only show reasoning when full=true
                if (full && true) { // status === "streaming" && isLastMessage) {
                  return (
                    <Reasoning
                      key={`${message.id}-${partIndex}`}
                      className="w-full"
                      defaultOpen={false}
                      isStreaming={
                        status === "streaming" &&
                        partIndex === message.parts.length - 1 &&
                        isLastMessage
                      }
                    >
                      <ReasoningTrigger />
                      <ReasoningContent>{part.text}</ReasoningContent>
                    </Reasoning>
                  );
                }
                return null;
              default:
                // Handle tool parts - only show when full=true
                if (full && part.type.startsWith("tool-")) {
                  const toolPart = part as ToolUIPart;
                  // Extract tool name from type (e.g., "tool-eval" -> "eval")
                  const toolName = toolPart.type.split("-").slice(1).join("-");
                  return (
                    <Tool
                      key={`${message.id}-${partIndex}`}
                      defaultOpen={false && status === "streaming"}
                    >
                      <ToolHeader type={toolPart.type} state={toolPart.state} />
                      <ToolContent>
                        <ToolInput input={toolPart.input} toolType={toolName} />
                        <ToolOutput
                          output={toolPart.output}
                          errorText={toolPart.errorText}
                          toolType={toolName}
                        />
                      </ToolContent>
                    </Tool>
                  );
                }
                return null;
            }
          })}

          {/* Loading states */}
          {status !== "error" &&
            status !== "ready" &&
            textParts.length === 0 && (
              <div className="flex items-center gap-2">
                <Loader />
                <div className="text-[10px] text-gray-400 flex-1">
                  {message.parts.at(-1)?.type === "text"
                    ? "Typing..."
                    : message.parts.at(-1)?.type === "reasoning"
                    ? "Thinking..."
                    : message.parts.at(-1)?.type.includes("tool")
                    ? "Tools..."
                    : "Processing..."}
                </div>
              </div>
            )}

          {/* Empty reply state */}
          {status === "ready" && textParts.length === 0 && (
            <div className="text-red-500 text-sm mt-2 px-4">Empty reply</div>
          )}

          {/* Error state */}
          {status === "error" && isLastMessage && (
            <div className="text-red-500 text-sm mt-2 px-4">
              Error, please retry later!
            </div>
          )}

          {/* Timestamp */}
          <div className="text-[10px] text-gray-400">
            {message.metadata?.createdAt?.toLocaleString() || ""}
          </div>
        </MessageContent>
      </Message>

      {/* Actions */}
      {showActions && (
        <Actions>
          <Action onClick={handleCopy} label="Copy">
            <CopyIcon className="size-3" />
          </Action>
        </Actions>
      )}
    </div>
  );
});
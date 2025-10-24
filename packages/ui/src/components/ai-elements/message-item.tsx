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
  onRegenerate: (messageId: string) => void;
}

export const MessageItem = React.memo(function MessageItem({
  message,
  status,
  isLastMessage,
  onRegenerate,
}: MessageItemProps) {
  const handleCopy = React.useCallback(() => {
    const textParts = message.parts.filter((part) => part.type === "text");
    const allText = textParts.map((part) => part.text).join("\n");
    navigator.clipboard.writeText(allText);
  }, [message.parts]);

  const handleRegenerate = React.useCallback(() => {
    onRegenerate(message.id);
  }, [message.id, onRegenerate]);

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

  const showRegenerateAction = React.useMemo(
    () => status === "error" || (status === "ready" && textParts.length === 0),
    [status, textParts.length]
  );

  return (
    <div>
      {/* Sources */}
      {message.role === "assistant" && sourceParts.length > 0 && (
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
              case "reasoning":
                if (true) { // status === "streaming" && isLastMessage) {
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
                // Handle tool parts
                if (part.type.startsWith("tool-")) {
                  const toolPart = part as ToolUIPart;
                  return (
                    <Tool
                      key={`${message.id}-${partIndex}`}
                      defaultOpen={false && status === "streaming"}
                    >
                      <ToolHeader type={toolPart.type} state={toolPart.state} />
                      <ToolContent>
                        <ToolInput input={toolPart.input} />
                        <ToolOutput
                          output={toolPart.output}
                          errorText={toolPart.errorText}
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
            {message.metadata?.createdAt.toLocaleString() || ""}
          </div>
        </MessageContent>
      </Message>

      {/* Actions */}
      {showActions && (
        <Actions>
          {showRegenerateAction && (
            <Action onClick={handleRegenerate} label="Regenerate">
              <RefreshCcwIcon className="size-3" />
            </Action>
          )}
          <Action onClick={handleCopy} label="Copy">
            <CopyIcon className="size-3" />
          </Action>
        </Actions>
      )}
    </div>
  );
});
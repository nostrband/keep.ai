"use client";

import React from "react";
import { MessageItem } from "../ai-elements/message-item";
import { Loader } from "../ai-elements/loader";
import { AssistantUIMessage } from "@app/proto";

interface MessageListProps {
  messages: AssistantUIMessage[];
  status: "ready" | "streaming" | "submitted" | "error";
  onRegenerate: (messageId: string) => void;
}

export const MessageList = React.memo(function MessageList({
  messages,
  status,
  onRegenerate,
}: MessageListProps) {
  return (
    <>
      {messages.map((message, index) => (
        <MessageItem
          key={message.id}
          message={message}
          status={status}
          isLastMessage={index === messages.length - 1}
          onRegenerate={onRegenerate}
        />
      ))}
      {status === "submitted" && <Loader />}
    </>
  );
});
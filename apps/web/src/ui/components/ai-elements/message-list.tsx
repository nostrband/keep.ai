"use client";

import React from "react";
import { MessageItem } from "../ai-elements/message-item";
import { Loader } from "../ai-elements/loader";
import { AssistantUIMessage } from "@app/proto";

interface MessageListProps {
  messages: AssistantUIMessage[];
  status: "ready" | "streaming" | "submitted" | "error";
  full?: boolean;
}

export const MessageList = React.memo(function MessageList({
  messages,
  status,
  full = true,
}: MessageListProps) {
  return (
    <>
      {messages.map((message, index) => (
        <MessageItem
          key={message.id}
          message={message}
          status={status}
          isLastMessage={index === messages.length - 1}
          full={full}
        />
      ))}
      {status === "submitted" && <Loader />}
    </>
  );
});
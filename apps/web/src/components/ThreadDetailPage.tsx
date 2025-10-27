import React from "react";
import { useParams } from "react-router-dom";
import { useThreadMessages, useThread } from "../hooks/dbThreadReads";
import SharedHeader from "./SharedHeader";
import {
  MessageList,
} from "../ui";

export default function ThreadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: thread } = useThread(id!);
  const { data: messages = [], isLoading } = useThreadMessages(id!);

  if (!id) {
    return <div>Thread ID not found</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader
        title="Threads"
        subtitle={thread ? (thread.title || `Thread ${thread.id.slice(0, 8)}`) : undefined}
      />

      {/* Main content */}
      <div className="pt-6 pb-6">
        {isLoading ? (
          <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-center">
            <div>Loading messages...</div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto px-6">
            <MessageList
              messages={messages}
              status="ready"
              full={true}
            />
          </div>
        )}
      </div>
    </div>
  );
}
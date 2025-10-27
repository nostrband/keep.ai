import React from "react";
import { useWorkingMemory } from "../hooks/dbMemoryReads";
import SharedHeader from "./SharedHeader";
import { Message, MessageContent, MessageAvatar, MessageItem } from "../ui";
import { AssistantUIMessage } from "packages/proto/dist";

export default function MemoryPage() {
  const { data: workingMemory, isLoading } = useWorkingMemory();

  // Create a synthetic message to display the working memory content
  const syntheticMessage: AssistantUIMessage = {
    id: "memory",
    role: "assistant" as const,
    parts: [
      {
        type: "text",
        text: workingMemory || "No working memory content available.",
      },
    ],
    metadata: {
      createdAt: new Date().toISOString(),
    },
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader title="Memory" />

      {/* Main content */}
      <div className="pt-6 pb-6">
        {isLoading ? (
          <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-center">
            <div>Loading memory...</div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto px-6">
            <MessageItem
              isLastMessage={true}
              message={syntheticMessage}
              status="ready"
              full={true}
            />
            {/* <Message from="assistant">
              <MessageAvatar src="/api/placeholder/32/32" name="Assistant" />
              <MessageContent variant="flat">
                <div className="prose prose-sm max-w-none">
                  {workingMemory ? (
                    <div dangerouslySetInnerHTML={{ __html: workingMemory }} />
                  ) : (
                    <p className="text-gray-500">
                      No working memory content available.
                    </p>
                  )}
                </div>
              </MessageContent>
            </Message> */}
          </div>
        )}
      </div>
    </div>
  );
}

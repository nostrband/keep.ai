import React from "react";
import { useWorkingMemory } from "../hooks/dbMemoryReads";
import SharedHeader from "./SharedHeader";
import { Response } from "../ui/components/ai-elements/response";

export default function MemoryPage() {
  const { data: workingMemory, isLoading } = useWorkingMemory();

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
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="prose prose-sm max-w-none">
                <Response>
                  {workingMemory || "No working memory content available."}
                </Response>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

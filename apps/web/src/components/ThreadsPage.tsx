import React from "react";
import { Link } from "react-router-dom";
import { useAllThreads } from "../hooks/dbThreadReads";
import SharedHeader from "./SharedHeader";

export default function ThreadsPage() {
  const { data: threads = [], isLoading } = useAllThreads();

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader title="Threads" />

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-6 py-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div>Loading threads...</div>
          </div>
        ) : threads.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-gray-500">No threads found</div>
          </div>
        ) : (
          <div className="space-y-4">
            {threads.map((thread) => (
              <Link
                key={thread.id}
                to={`/threads/${thread.id}`}
                className="block p-4 bg-white rounded-lg border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900">
                      {thread.title || `Thread ${thread.id.slice(0, 8)}`}
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Created: {new Date(thread.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-sm text-gray-400">
                    {new Date(thread.updated_at).toLocaleDateString()}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
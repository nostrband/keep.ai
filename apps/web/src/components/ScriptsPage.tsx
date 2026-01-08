import React from "react";
import { Link } from "react-router-dom";
import { useScripts } from "../hooks/dbScriptReads";
import SharedHeader from "./SharedHeader";
import {
  Badge,
} from "../ui";

export default function ScriptsPage() {
  const { data: scripts = [], isLoading } = useScripts();

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader title="Scripts" />

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-6 py-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div>Loading scripts...</div>
          </div>
        ) : scripts.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-gray-500">No scripts found</div>
          </div>
        ) : (
          <div className="space-y-4">
            {scripts.map((script: any) => (
              <Link
                key={script.id}
                to={`/scripts/${script.id}`}
                className="block p-4 bg-white rounded-lg border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-medium text-gray-900">
                        Script {script.id.slice(0, 8)}
                      </h3>
                      <Badge variant="outline">v{script.version}</Badge>
                    </div>
                    {script.change_comment && (
                      <p className="text-sm text-gray-600 mb-2 line-clamp-2">
                        {script.change_comment}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>
                        Task: {script.task_id.slice(0, 8)}
                      </span>
                      <span>
                        Updated: {new Date(script.timestamp).toLocaleString()}
                      </span>
                    </div>
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

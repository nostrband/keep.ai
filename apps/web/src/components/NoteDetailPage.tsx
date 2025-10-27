import React from "react";
import { useParams } from "react-router-dom";
import { useNote } from "../hooks/dbNoteReads";
import SharedHeader from "./SharedHeader";
import { Badge } from "../ui/components/ui/badge";
import { Response } from "../ui/components/ai-elements/response";

export default function NoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: note, isLoading } = useNote(id!);

  if (!id) {
    return <div>Note ID not found</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader
        title="Notes"
        subtitle={note ? (note.title || `Note ${note.id.slice(0, 8)}`) : undefined}
      />

      {/* Main content */}
      <div className="pt-6 pb-6">
        {isLoading ? (
          <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-center">
            <div>Loading note...</div>
          </div>
        ) : !note ? (
          <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-center">
            <div>Note not found</div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto px-6">
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              {/* Note header */}
              <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900 mb-2">
                  {note.title || "Untitled"}
                </h1>
                <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
                  <span>Created {new Date(note.created).toLocaleDateString()}</span>
                  <span>Updated {new Date(note.updated).toLocaleDateString()}</span>
                  <Badge 
                    variant={note.priority === "high" ? "destructive" : note.priority === "medium" ? "default" : "secondary"}
                  >
                    {note.priority}
                  </Badge>
                </div>
                {note.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {note.tags.map((tag, index) => (
                      <Badge key={index} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* Note content */}
              <div className="prose prose-sm max-w-none">
                <Response>{note.content}</Response>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
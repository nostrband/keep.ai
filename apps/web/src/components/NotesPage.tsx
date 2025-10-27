import React from "react";
import { Link } from "react-router-dom";
import { useNotes } from "../hooks/dbNoteReads";
import SharedHeader from "./SharedHeader";
import { Badge } from "../ui/components/ui/badge";

export default function NotesPage() {
  const { data: notes = [], isLoading } = useNotes();

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader title="Notes" />

      {/* Main content */}
      <div className="pt-6 pb-6">
        {isLoading ? (
          <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-center">
            <div>Loading notes...</div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto px-6">
            {notes.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500 mb-4">No notes found</p>
              </div>
            ) : (
              <div className="space-y-4">
                {notes.map((note) => (
                  <Link
                    key={note.id}
                    to={`/notes/${note.id}`}
                    className="block p-4 bg-white rounded-lg border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-medium text-gray-900 mb-1">
                          {note.title || "Untitled"}
                        </h3>
                        {note.snippet && (
                          <p className="text-sm text-gray-600 mb-2 line-clamp-2">
                            {note.snippet}
                          </p>
                        )}
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span>Updated {new Date(note.updated).toLocaleDateString()}</span>
                          <Badge 
                            variant={note.priority === "high" ? "destructive" : note.priority === "medium" ? "default" : "secondary"}
                            className="text-xs"
                          >
                            {note.priority}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    {note.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {note.tags.map((tag, index) => (
                          <Badge key={index} variant="outline" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
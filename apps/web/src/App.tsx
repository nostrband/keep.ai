import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useCRSqliteQuery } from "./QueryProvider";
import HomePage from "./components/HomePage";
import ChatPage from "./components/ChatPage";
import ThreadsPage from "./components/ThreadsPage";
import ThreadDetailPage from "./components/ThreadDetailPage";
import TasksPage from "./components/TasksPage";
import TaskDetailPage from "./components/TaskDetailPage";
import TaskRunDetailPage from "./components/TaskRunDetailPage";
import NotesPage from "./components/NotesPage";
import NoteDetailPage from "./components/NoteDetailPage";
import DevicesPage from "./components/DevicesPage";
import { ConnectDeviceDialog } from "./components/ConnectDeviceDialog";

function App() {
  const { dbStatus, error } = useCRSqliteQuery();

  if (dbStatus === "initializing") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div>Initializing database...</div>
      </div>
    );
  }

  if (dbStatus === "syncing") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div>Updating database...</div>
      </div>
    );
  }

  if (dbStatus === "error") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div>Database error: {error}</div>
      </div>
    );
  }

  if (dbStatus === "disconnected") {
    return (
      <div className="min-h-screen bg-gray-50">
        <ConnectDeviceDialog />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/chat" element={<Navigate to="/chat/new" replace />} />
        <Route path="/chat/:id" element={<ChatPage />} />
        <Route path="/threads" element={<ThreadsPage />} />
        <Route path="/threads/:id" element={<ThreadDetailPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/tasks/:id" element={<TaskDetailPage />} />
        <Route path="/tasks/:id/run/:runId" element={<TaskRunDetailPage />} />
        <Route path="/notes" element={<NotesPage />} />
        <Route path="/notes/:id" element={<NoteDetailPage />} />
        <Route path="/devices" element={<DevicesPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

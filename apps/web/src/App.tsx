import {
  BrowserRouter,
  HashRouter,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { useState } from "react";
import ChatPage from "./components/ChatPage";
import NewPage from "./components/NewPage";
import ChatDetailPage from "./components/ChatDetailPage";
import ThreadsPage from "./components/ThreadsPage";
import ThreadDetailPage from "./components/ThreadDetailPage";
import TasksPage from "./components/TasksPage";
import TaskDetailPage from "./components/TaskDetailPage";
import TaskRunDetailPage from "./components/TaskRunDetailPage";
import ScriptsPage from "./components/ScriptsPage";
import ScriptDetailPage from "./components/ScriptDetailPage";
import ScriptRunDetailPage from "./components/ScriptRunDetailPage";
import WorkflowsPage from "./components/WorkflowsPage";
import WorkflowDetailPage from "./components/WorkflowDetailPage";
import NotesPage from "./components/NotesPage";
import NoteDetailPage from "./components/NoteDetailPage";
import FilesPage from "./components/FilesPage";
import DevicesPage from "./components/DevicesPage";
import ConsolePage from "./components/ConsolePage";
import SettingsPage from "./components/SettingsPage";
import { ConnectDeviceDialog } from "./components/ConnectDeviceDialog";
import { AuthDialog } from "./components/AuthDialog";
import { ClerkAuthProvider } from "./components/ClerkAuthProvider";
import { useDbQuery } from "./hooks/dbQuery";
import { useConfig } from "./hooks/useConfig";
import { CLERK_PUBLISHABLE_KEY } from "./constants/auth";

// Access build-time constants
declare const __SERVERLESS__: boolean;
declare const __ELECTRON__: boolean;

function SyncingStatus({ isServerless, isInitializing }: { isServerless: boolean; isInitializing: boolean }) {
  const [showTroubleOptions, setShowTroubleOptions] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { resyncTransport, reconnectServerless } = useDbQuery();

  const handleResync = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    
    try {
      await resyncTransport();
      // The page will reload after 3 seconds from the resyncTransport function
    } catch (error) {
      console.error("Resync failed:", error);
      setIsProcessing(false);
    }
  };

  const handleReconnect = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    
    try {
      await reconnectServerless();
      // The page will reload after 3 seconds from the reconnectServerless function
    } catch (error) {
      console.error("Reconnect failed:", error);
      setIsProcessing(false);
    }
  };

  if (isProcessing) {
    return <div>Please wait...</div>;
  }

  return (
    <div className="text-center">
      <div className="mb-4">{isInitializing ? "Initializing database..." : "Updating database..."}</div>
      {isServerless && (
        <div>
          {!showTroubleOptions ? (
            <button
              onClick={() => setShowTroubleOptions(true)}
              className="text-blue-600 hover:text-blue-800 underline"
            >
              Having trouble?
            </button>
          ) : (
            <div className="space-y-2">
              <div>
                Try to{" "}
                <button
                  onClick={handleResync}
                  className="text-blue-600 hover:text-blue-800 underline"
                >
                  re-sync
                </button>
              </div>
              <div>
                If that doesn't help,{" "}
                <button
                  onClick={handleReconnect}
                  className="text-blue-600 hover:text-blue-800 underline"
                >
                  reconnect
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function App() {
  const { dbStatus, error } = useDbQuery();
  const isServerless = __SERVERLESS__;
  const isElectron = __ELECTRON__;
  const {
    isConfigValid,
    isLoading: configLoading,
    error: configError,
    recheckConfig,
  } = useConfig();

  // For non-serverless mode, check configuration first
  if (!isServerless) {
    if (configLoading) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div>Checking configuration...</div>
        </div>
      );
    }

    if (configError) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div>Configuration error: {configError}</div>
        </div>
      );
    }

    if (isConfigValid === false) {
      return (
        <ClerkAuthProvider clerkPublishableKey={CLERK_PUBLISHABLE_KEY}>
          <AuthDialog 
            onAuthenticated={recheckConfig}
            clerkPublishableKey={CLERK_PUBLISHABLE_KEY}
          />
        </ClerkAuthProvider>
      );
    }
  }

  if (dbStatus === "initializing") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <SyncingStatus isServerless={isServerless} isInitializing={true} />
      </div>
    );
  }

  if (dbStatus === "syncing") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <SyncingStatus isServerless={isServerless} isInitializing={false} />
      </div>
    );
  }

  if (dbStatus === "locked") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div>Another tab with Keep.AI is active.</div>
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

  // if (dbStatus === "reload") {
  //   return (
  //     <div className="min-h-screen bg-gray-50 flex items-center justify-center">
  //       <div>Please reload the page</div>
  //     </div>
  //   );
  // }

  // if (dbStatus === "reconnecting") {
  //   return (
  //     <div className="min-h-screen bg-gray-50 flex items-center justify-center">
  //       <div>Reconnecting</div>
  //     </div>
  //   );
  // }

  // Use HashRouter in Electron to avoid file:// protocol issues with routing
  // const isElectron = (window as any).env?.API_ENDPOINT?.includes("localhost:");
  const Router = isElectron ? HashRouter : BrowserRouter;

  return (
    <Router>
      <Routes>
        <Route path="/" element={<ChatPage />} />
        <Route path="/new" element={<NewPage />} />
        <Route path="/chats/:id" element={<ChatDetailPage />} />
        <Route path="/threads" element={<ThreadsPage />} />
        <Route path="/threads/:id" element={<ThreadDetailPage />} />
        <Route path="/workflows" element={<WorkflowsPage />} />
        <Route path="/workflows/:id" element={<WorkflowDetailPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/tasks/:id" element={<TaskDetailPage />} />
        <Route path="/tasks/:id/run/:runId" element={<TaskRunDetailPage />} />
        <Route path="/scripts" element={<ScriptsPage />} />
        <Route path="/scripts/:id" element={<ScriptDetailPage />} />
        <Route path="/scripts/:id/runs/:runId" element={<ScriptRunDetailPage />} />
        <Route path="/notes" element={<NotesPage />} />
        <Route path="/notes/:id" element={<NoteDetailPage />} />
        <Route path="/files" element={<FilesPage />} />
        <Route path="/devices" element={<DevicesPage />} />
        <Route path="/console" element={<ConsolePage />} />
        {!isServerless && <Route path="/settings" element={<SettingsPage />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;

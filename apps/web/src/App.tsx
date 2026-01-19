import {
  BrowserRouter,
  HashRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { useState, useEffect, useRef, useCallback } from "react";
import { APP_UPDATE_EVENT } from "./main";
import MainPage from "./components/MainPage";
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

// Custom event for focus-input - MainPage listens for this
const FOCUS_INPUT_EVENT = 'keep-ai-focus-input';

// Component to handle electron-specific IPC events (navigation, focus-input, pause-all)
function ElectronIPCHandler() {
  const navigate = useNavigate();
  const location = useLocation();
  const { api } = useDbQuery();

  // Use refs to hold current values so the effect doesn't re-run on every render
  const navigateRef = useRef(navigate);
  const locationRef = useRef(location);
  const apiRef = useRef(api);

  // Keep refs updated with current values
  useEffect(() => {
    navigateRef.current = navigate;
  });
  useEffect(() => {
    locationRef.current = location;
  });
  useEffect(() => {
    apiRef.current = api;
  });

  // Handle focus-input from tray menu "New automation..."
  const handleFocusInput = useCallback(() => {
    // Navigate to main page if not already there
    if (locationRef.current.pathname !== '/') {
      navigateRef.current('/');
    }
    // Dispatch custom event for MainPage to focus the input
    // Small delay to allow navigation to complete
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent(FOCUS_INPUT_EVENT));
    }, 100);
  }, []);

  // Handle pause-all-automations from tray menu
  const handlePauseAllAutomations = useCallback(async () => {
    if (!apiRef.current) return;

    try {
      // Get all workflows (default limit of 100 should be sufficient)
      const workflows = await apiRef.current.scriptStore.listWorkflows();

      // Filter to active workflows only
      const activeWorkflows = workflows.filter((w: { status: string }) => w.status === 'active');

      if (activeWorkflows.length === 0) {
        console.debug('No active workflows to pause');
        return;
      }

      // Pause each active workflow
      for (const workflow of activeWorkflows) {
        await apiRef.current.scriptStore.updateWorkflow({
          ...workflow,
          status: 'disabled',
        });
      }

      console.debug(`Paused ${activeWorkflows.length} workflows`);
    } catch (error) {
      console.error('Failed to pause all automations:', error);
    }
  }, []);

  useEffect(() => {
    if (!window.electronAPI) return;

    // Set up listener for navigation from notification clicks
    const unsubNavigate = window.electronAPI.onNavigateTo((path: string) => {
      navigateRef.current(path);
    });

    // Set up listener for focus-input from tray menu
    const unsubFocusInput = window.electronAPI.onFocusInput(handleFocusInput);

    // Set up listener for pause-all-automations from tray menu
    const unsubPauseAll = window.electronAPI.onPauseAllAutomations(handlePauseAllAutomations);

    // Clean up all listeners on unmount
    return () => {
      unsubNavigate();
      unsubFocusInput();
      unsubPauseAll();
    };
  }, [handleFocusInput, handlePauseAllAutomations]);

  return null;
}

// Export the custom event name for MainPage to use
export { FOCUS_INPUT_EVENT };

// Banner shown when the app has been updated via service worker
function AppUpdateBanner() {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const handleAppUpdate = () => {
      setShowBanner(true);
      // Auto-dismiss after 10 seconds
      setTimeout(() => setShowBanner(false), 10000);
    };

    window.addEventListener(APP_UPDATE_EVENT, handleAppUpdate);
    return () => window.removeEventListener(APP_UPDATE_EVENT, handleAppUpdate);
  }, []);

  if (!showBanner) return null;

  return (
    <div className="fixed top-0 left-0 right-0 bg-blue-600 text-white px-4 py-2 text-sm flex items-center justify-between z-50 shadow-md">
      <span>App updated to a new version</span>
      <button
        onClick={() => setShowBanner(false)}
        className="ml-4 p-1 hover:bg-blue-700 rounded"
        aria-label="Dismiss"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
    </div>
  );
}

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
      {/* Handle electron-specific IPC events (navigation, focus-input, pause-all) */}
      {isElectron && <ElectronIPCHandler />}
      {/* Show banner when app is updated via service worker (not in Electron) */}
      {!isElectron && <AppUpdateBanner />}
      <Routes>
        <Route path="/" element={<MainPage />} />
        <Route path="/chat" element={<ChatPage />} />
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

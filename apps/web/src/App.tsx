import {
  BrowserRouter,
  HashRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
} from "react-router-dom";
import { useState, useEffect, useRef, useCallback } from "react";
import { APP_UPDATE_EVENT } from "./main";
import MainPage from "./components/MainPage";
import ChatPage from "./components/ChatPage";
import ChatDetailPage from "./components/ChatDetailPage";
import ThreadsPage from "./components/ThreadsPage";
import ThreadDetailPage from "./components/ThreadDetailPage";
import TasksPage from "./components/TasksPage";
import TaskDetailPage from "./components/TaskDetailPage";
import TaskRunDetailPage from "./components/TaskRunDetailPage";
import ScriptsPage from "./components/ScriptsPage";
import ScriptDetailPage from "./components/ScriptDetailPage";
import ScriptRunDetailPage from "./components/ScriptRunDetailPage";
import HandlerRunDetailPage from "./components/HandlerRunDetailPage";
import WorkflowsPage from "./components/WorkflowsPage";
import WorkflowDetailPage from "./components/WorkflowDetailPage";
import WorkflowInputsPage from "./components/WorkflowInputsPage";
import InputDetailPage from "./components/InputDetailPage";
import WorkflowOutputsPage from "./components/WorkflowOutputsPage";
import WorkflowScriptRunsPage from "./components/WorkflowScriptRunsPage";
import ArchivedPage from "./components/ArchivedPage";
import NotesPage from "./components/NotesPage";
import NoteDetailPage from "./components/NoteDetailPage";
import FilesPage from "./components/FilesPage";
import DevicesPage from "./components/DevicesPage";
import ConsolePage from "./components/ConsolePage";
import SettingsPage from "./components/SettingsPage";
import NotificationsPage from "./components/NotificationsPage";
import { ConnectDeviceDialog } from "./components/ConnectDeviceDialog";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useDbQuery } from "./hooks/dbQuery";

// Access build-time constants
declare const __SERVERLESS__: boolean;
declare const __ELECTRON__: boolean;

// Component to handle electron-specific IPC events (navigation, focus-input, pause-all)
function ElectronIPCHandler() {
  const navigate = useNavigate();
  const { api } = useDbQuery();

  // Use refs to hold current values so the effect doesn't re-run on every render
  const navigateRef = useRef(navigate);
  const apiRef = useRef(api);

  // Keep refs updated with current values
  useEffect(() => {
    navigateRef.current = navigate;
  });
  useEffect(() => {
    apiRef.current = api;
  });

  // Handle focus-input from tray menu "New automation..."
  const handleFocusInput = useCallback(() => {
    // Navigate to main page with focus param - MainPage will handle the focus
    navigateRef.current('/?focus=input');
  }, []);

  // Handle pause-all-automations from tray menu
  const handlePauseAllAutomations = useCallback(async () => {
    if (!apiRef.current) return;

    try {
      // Use atomic SQL operation to pause all active workflows
      const count = await apiRef.current.scriptStore.pauseAllWorkflows();

      if (count === 0) {
        console.debug('No active workflows to pause');
        // Show OS notification even for "no workflows to pause" case
        if (window.electronAPI) {
          const shown = await window.electronAPI.showNotification({
            title: 'No automations to pause',
            body: 'All automations are already paused or there are no active automations.',
          });
          if (!shown) {
            console.warn('Failed to show notification: No automations to pause');
          }
        }
        return;
      }

      console.debug(`Paused ${count} workflows`);

      // Show OS notification with the count
      if (window.electronAPI) {
        const workflowWord = count === 1 ? 'automation' : 'automations';
        const verb = count === 1 ? 'has' : 'have';
        const shown = await window.electronAPI.showNotification({
          title: `Paused ${count} ${workflowWord}`,
          body: `All ${workflowWord} ${verb} been paused. They will not run until you resume them.`,
        });
        if (!shown) {
          console.warn(`Failed to show notification: Paused ${count} ${workflowWord}`);
        }
      }
    } catch (error) {
      console.error('Failed to pause all automations:', error);

      // Show error notification
      if (window.electronAPI) {
        const shown = await window.electronAPI.showNotification({
          title: 'Failed to pause automations',
          body: error instanceof Error ? error.message : 'An unexpected error occurred.',
        });
        if (!shown) {
          console.warn('Failed to show error notification for pause automations failure');
        }
      }
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

// Banner shown when the app has been updated via service worker
function AppUpdateBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const autoDismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleAppUpdate = () => {
      setShowBanner(true);
      // Auto-dismiss after 10 seconds
      autoDismissTimeoutRef.current = setTimeout(() => {
        setShowBanner(false);
        autoDismissTimeoutRef.current = null;
      }, 10000);
    };

    window.addEventListener(APP_UPDATE_EVENT, handleAppUpdate);
    return () => {
      window.removeEventListener(APP_UPDATE_EVENT, handleAppUpdate);
      // Clean up timeout on unmount
      if (autoDismissTimeoutRef.current) {
        clearTimeout(autoDismissTimeoutRef.current);
      }
    };
  }, []);

  if (!showBanner) return null;

  return (
    <div className="fixed top-0 left-0 right-0 bg-blue-600 text-white px-4 py-2 text-sm flex items-center justify-between z-[60] shadow-md">
      <span>App updated to a new version</span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => window.location.reload()}
          className="px-3 py-1 bg-white text-blue-600 rounded hover:bg-blue-50 font-medium"
        >
          Reload
        </button>
        <button
          onClick={() => setShowBanner(false)}
          className="p-1 hover:bg-blue-700 rounded"
          aria-label="Dismiss"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
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

  // Auth is now handled by HeaderAuthNotice and AuthEventItem (non-blocking)
  // Users can browse the app freely; auth prompts appear as dismissable modals

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
      <ErrorBoundary>
      <Routes>
        <Route path="/" element={<MainPage />} />
        <Route path="/chat" element={<ChatPage />} />
        {/* Legacy routes - redirect to home */}
        <Route path="/chat/main" element={<Navigate to="/" replace />} />
        <Route path="/new" element={<Navigate to="/" replace />} />
        <Route path="/chats/:id" element={<ChatDetailPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/notifications/:workflowId" element={<NotificationsPage />} />
        <Route path="/threads" element={<ThreadsPage />} />
        <Route path="/threads/:id" element={<ThreadDetailPage />} />
        <Route path="/workflows" element={<WorkflowsPage />} />
        <Route path="/workflows/:id" element={<WorkflowDetailPage />} />
        <Route path="/workflow/:id/inputs" element={<WorkflowInputsPage />} />
        <Route path="/workflow/:id/input/:inputId" element={<InputDetailPage />} />
        <Route path="/workflow/:id/outputs" element={<WorkflowOutputsPage />} />
        <Route path="/workflow/:id/runs" element={<WorkflowScriptRunsPage />} />
        <Route path="/archived" element={<ArchivedPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/tasks/:id" element={<TaskDetailPage />} />
        <Route path="/tasks/:id/run/:runId" element={<TaskRunDetailPage />} />
        <Route path="/scripts" element={<ScriptsPage />} />
        <Route path="/scripts/:id" element={<ScriptDetailPage />} />
        <Route path="/scripts/:id/runs/:runId" element={<ScriptRunDetailPage />} />
        <Route path="/scripts/:id/runs/:runId/handler/:handlerRunId" element={<HandlerRunDetailPage />} />
        <Route path="/notes" element={<NotesPage />} />
        <Route path="/notes/:id" element={<NoteDetailPage />} />
        <Route path="/files" element={<FilesPage />} />
        <Route path="/devices" element={<DevicesPage />} />
        <Route path="/console" element={<ConsolePage />} />
        {!isServerless && <Route path="/settings" element={<SettingsPage />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </ErrorBoundary>
    </Router>
  );
}

export default App;

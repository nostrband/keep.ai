/**
 * ConnectionsSection - Manages OAuth service connections.
 *
 * Displays connected accounts for each service (Gmail, Google Drive, etc.)
 * and provides UI for connecting new accounts, disconnecting, and checking status.
 *
 * See specs/connectors-05-ui-connections-page.md for design details.
 */

import { useState, useEffect, useRef } from "react";
import { Mail, HardDrive, Sheet, FileText, BookOpen, MoreVertical, Plus, RefreshCw, Unlink, Check, AlertCircle, Pencil } from "lucide-react";
import { useConnections } from "../hooks/dbConnectionReads";
import { useUpdateConnectionLabel, useDisconnectConnection } from "../hooks/dbWrites";
import { useAutoHidingMessage } from "../hooks/useAutoHidingMessage";
import { API_ENDPOINT } from "../const";
import { openUrl } from "../lib/url-utils";
import {
  Button,
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from "../ui";

/**
 * Service definition for UI display.
 */
interface ServiceInfo {
  id: string;
  name: string;
  icon: React.ReactNode;
  description: string;
}

/**
 * Available services with their UI metadata.
 */
const SERVICES: ServiceInfo[] = [
  {
    id: "gmail",
    name: "Gmail",
    icon: <Mail className="w-5 h-5" />,
    description: "Read and send emails",
  },
  {
    id: "gdrive",
    name: "Google Drive",
    icon: <HardDrive className="w-5 h-5" />,
    description: "Access files and folders",
  },
  {
    id: "gsheets",
    name: "Google Sheets",
    icon: <Sheet className="w-5 h-5" />,
    description: "Read and write spreadsheets",
  },
  {
    id: "gdocs",
    name: "Google Docs",
    icon: <FileText className="w-5 h-5" />,
    description: "Read and edit documents",
  },
  {
    id: "notion",
    name: "Notion",
    icon: <BookOpen className="w-5 h-5" />,
    description: "Access workspaces, databases, and pages",
  },
];

/**
 * Get service info by ID.
 */
function getServiceInfo(serviceId: string): ServiceInfo | undefined {
  return SERVICES.find((s) => s.id === serviceId);
}

/**
 * Status badge component for connection status.
 */
function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "connected":
      return (
        <Badge className="bg-green-100 text-green-800 border-green-200">
          <Check className="w-3 h-3 mr-1" />
          Connected
        </Badge>
      );
    case "expired":
      return (
        <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">
          <AlertCircle className="w-3 h-3 mr-1" />
          Expired
        </Badge>
      );
    case "error":
      return (
        <Badge className="bg-red-100 text-red-800 border-red-200">
          <AlertCircle className="w-3 h-3 mr-1" />
          Error
        </Badge>
      );
    default:
      return (
        <Badge variant="outline">
          {status}
        </Badge>
      );
  }
}

/**
 * Connection card component for displaying a single connection.
 */
function ConnectionCard({
  connection,
  service,
  onDisconnect,
  onReconnect,
  onCheck,
  onRename,
  isChecking,
}: {
  connection: {
    id: string;
    service: string;
    account_id: string;
    status: string;
    label: string | null;
    error: string | null;
    metadata: Record<string, unknown> | null;
  };
  service: ServiceInfo;
  onDisconnect: () => void;
  onReconnect: () => void;
  onCheck: () => void;
  onRename: (newLabel: string) => void;
  isChecking: boolean;
}) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [newLabel, setNewLabel] = useState(connection.label || "");

  // Sync newLabel with external label changes when not actively renaming
  useEffect(() => {
    if (!isRenaming) {
      setNewLabel(connection.label || "");
    }
  }, [connection.label, isRenaming]);

  const handleRenameSubmit = () => {
    if (newLabel.trim() !== connection.label) {
      onRename(newLabel.trim());
    }
    setIsRenaming(false);
  };

  const displayName = connection.metadata?.workspace_name as string || connection.account_id;

  return (
    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
      <div className="flex items-center gap-3">
        <div className="text-gray-600">
          {service.icon}
        </div>
        <div>
          <div className="font-medium text-gray-900">{displayName}</div>
          {isRenaming ? (
            <div className="flex items-center gap-2 mt-1">
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Enter label"
                className="h-7 text-sm w-40"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameSubmit();
                  if (e.key === "Escape") setIsRenaming(false);
                }}
              />
              <Button size="sm" variant="outline" onClick={handleRenameSubmit} className="h-7 cursor-pointer">
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setIsRenaming(false)} className="h-7 cursor-pointer">
                Cancel
              </Button>
            </div>
          ) : (
            <>
              {connection.label && (
                <div className="text-sm text-gray-500">{connection.label}</div>
              )}
              {connection.status === "error" && connection.error && (
                <div className="text-sm text-red-600 mt-1">{connection.error}</div>
              )}
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <StatusBadge status={connection.status} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 cursor-pointer">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setIsRenaming(true)}>
              <Pencil className="w-4 h-4 mr-2" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCheck} disabled={isChecking}>
              <RefreshCw className={`w-4 h-4 mr-2 ${isChecking ? "animate-spin" : ""}`} />
              {isChecking ? "Checking..." : "Check Connection"}
            </DropdownMenuItem>
            {connection.status !== "connected" && (
              <DropdownMenuItem onClick={onReconnect}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Reconnect
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDisconnect} variant="destructive">
              <Unlink className="w-4 h-4 mr-2" />
              Disconnect
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/**
 * Service group component for displaying connections grouped by service.
 */
function ServiceGroup({
  service,
  connections,
  onConnect,
  onDisconnect,
  onReconnect,
  onCheck,
  onRename,
  checkingConnections,
  pendingService,
}: {
  service: ServiceInfo;
  connections: Array<{
    id: string;
    service: string;
    account_id: string;
    status: string;
    label: string | null;
    error: string | null;
    metadata: Record<string, unknown> | null;
  }>;
  onConnect: () => void;
  onDisconnect: (connectionId: string) => void;
  onReconnect: (service: string) => void;
  onCheck: (connectionId: string) => void;
  onRename: (connectionId: string, newLabel: string) => void;
  checkingConnections: Set<string>;
  pendingService: string | null;
}) {
  const isPending = pendingService === service.id;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-gray-600">{service.icon}</span>
          <h4 className="font-medium text-gray-900">{service.name}</h4>
        </div>
      </div>

      {connections.length === 0 ? (
        <div className="text-sm text-gray-500 py-2">
          No accounts connected
        </div>
      ) : (
        <div className="space-y-2">
          {connections.map((conn) => (
            <ConnectionCard
              key={conn.id}
              connection={conn}
              service={service}
              onDisconnect={() => onDisconnect(conn.id)}
              onReconnect={() => onReconnect(conn.service)}
              onCheck={() => onCheck(conn.id)}
              onRename={(newLabel) => onRename(conn.id, newLabel)}
              isChecking={checkingConnections.has(conn.id)}
            />
          ))}
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        onClick={onConnect}
        disabled={isPending}
        className="cursor-pointer"
      >
        {isPending ? (
          <>
            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            Connecting...
          </>
        ) : (
          <>
            <Plus className="w-4 h-4 mr-2" />
            Add {service.name} account
          </>
        )}
      </Button>
    </div>
  );
}

/**
 * Main ConnectionsSection component.
 */
export default function ConnectionsSection() {
  const { data: connections = [], isLoading } = useConnections();
  const updateLabelMutation = useUpdateConnectionLabel();
  const disconnectMutation = useDisconnectConnection(API_ENDPOINT);
  const [pendingService, setPendingService] = useState<string | null>(null);
  const [checkingConnections, setCheckingConnections] = useState<Set<string>>(new Set());
  const success = useAutoHidingMessage({ duration: 3000 });
  const [error, setError] = useState<string | null>(null);
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup pending timeout on unmount
  useEffect(() => {
    return () => {
      if (pendingTimeoutRef.current) {
        clearTimeout(pendingTimeoutRef.current);
      }
    };
  }, []);

  // Clear pending state when connection for that service appears
  // Note: success.show is stable (wrapped in useCallback), so we only depend on it
  useEffect(() => {
    if (pendingService && connections.some((c) => c.service === pendingService)) {
      // Clear the timeout since connection was successful
      if (pendingTimeoutRef.current) {
        clearTimeout(pendingTimeoutRef.current);
        pendingTimeoutRef.current = null;
      }
      setPendingService(null);
      success.show("Account connected successfully!");
    }
  }, [connections, pendingService, success.show]);

  const handleConnect = async (serviceId: string) => {
    try {
      setError(null);
      setPendingService(serviceId);

      const response = await fetch(`${API_ENDPOINT}/connectors/${serviceId}/connect`, {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to start connection");
      }

      const data = await response.json();
      openUrl(data.authUrl);

      // Clear any existing pending timeout
      if (pendingTimeoutRef.current) {
        clearTimeout(pendingTimeoutRef.current);
      }

      // Set a timeout to clear pending state if user doesn't complete auth
      pendingTimeoutRef.current = setTimeout(() => {
        setPendingService((prev) => (prev === serviceId ? null : prev));
        pendingTimeoutRef.current = null;
      }, 120000); // 2 minutes
    } catch (err) {
      setPendingService(null);
      setError(err instanceof Error ? err.message : "Failed to connect");
    }
  };

  const handleDisconnect = (connectionId: string) => {
    setError(null);
    disconnectMutation.mutate(connectionId, {
      onSuccess: () => {
        success.show("Account disconnected");
      },
      onError: (err) => {
        setError(err instanceof Error ? err.message : "Failed to disconnect");
      },
    });
  };

  const handleReconnect = async (serviceId: string) => {
    await handleConnect(serviceId);
  };

  const handleCheck = async (connectionId: string) => {
    try {
      setError(null);
      setCheckingConnections((prev) => new Set(prev).add(connectionId));

      const [service, accountId] = connectionId.split(":");

      const response = await fetch(
        `${API_ENDPOINT}/connectors/${service}/${encodeURIComponent(accountId)}/check`,
        { method: "POST" }
      );

      // Check response status before parsing JSON
      if (!response.ok) {
        // Try to get error message from response body
        let errorMessage = "Connection check failed";
        try {
          const data = await response.json();
          errorMessage = data.error || errorMessage;
        } catch {
          // Response body wasn't JSON, use status text
          errorMessage = response.statusText || errorMessage;
        }
        setError(errorMessage);
        return;
      }

      const data = await response.json();

      if (data.success) {
        success.show("Connection verified!");
      } else {
        setError(data.error || "Connection check failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check connection");
    } finally {
      setCheckingConnections((prev) => {
        const next = new Set(prev);
        next.delete(connectionId);
        return next;
      });
    }
  };

  const handleRename = async (connectionId: string, newLabel: string) => {
    try {
      setError(null);
      await updateLabelMutation.mutateAsync({
        connectionId,
        label: newLabel,
      });
      success.show("Label updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename");
    }
  };

  // Group connections by service
  const connectionsByService = SERVICES.map((service) => ({
    service,
    connections: connections.filter((c) => c.service === service.id),
  }));

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Service Connections</h3>
        </div>
        <div className="text-gray-500">Loading connections...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Service Connections</h3>
          <p className="text-sm text-gray-500 mt-1">
            Connect external services to enable automations
          </p>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 p-3 rounded-md border border-red-200">
          {error}
        </div>
      )}

      {success.message && (
        <div className="text-sm text-green-600 bg-green-50 p-3 rounded-md border border-green-200">
          {success.message}
        </div>
      )}

      <div className="space-y-6">
        {connectionsByService.map(({ service, connections: serviceConnections }) => (
          <ServiceGroup
            key={service.id}
            service={service}
            connections={serviceConnections}
            onConnect={() => handleConnect(service.id)}
            onDisconnect={handleDisconnect}
            onReconnect={handleReconnect}
            onCheck={handleCheck}
            onRename={handleRename}
            checkingConnections={checkingConnections}
            pendingService={pendingService}
          />
        ))}
      </div>
    </div>
  );
}

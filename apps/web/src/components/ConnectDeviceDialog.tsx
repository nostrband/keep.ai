import React, { useState } from "react";
import { useCRSqliteQuery } from "../QueryProvider";

interface ConnectDeviceDialogProps {
  onClose?: () => void;
}

export function ConnectDeviceDialog({ onClose }: ConnectDeviceDialogProps) {
  const { connectDevice, dbStatus, error } = useCRSqliteQuery();
  const [connectionString, setConnectionString] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async () => {
    if (!connectionString.trim()) {
      return;
    }

    setIsConnecting(true);
    try {
      await connectDevice(connectionString.trim());
      // Connection successful, dialog will be closed by parent when dbStatus changes
      if (onClose) {
        onClose();
      }
    } catch (err) {
      console.error("Failed to connect device:", err);
      // Error will be shown via the error state from context
    } finally {
      setIsConnecting(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isConnecting) {
      handleConnect();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-xl font-semibold mb-4">Connect Device</h2>
        
        <p className="text-gray-600 mb-4">
          To use the serverless version, you need to connect to a main device. 
          Paste the connection string from your main device below.
        </p>

        <div className="mb-4">
          <label htmlFor="connectionString" className="block text-sm font-medium text-gray-700 mb-2">
            Connection String
          </label>
          <textarea
            id="connectionString"
            value={connectionString}
            onChange={(e) => setConnectionString(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="nostr+keepai://..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            rows={3}
            disabled={isConnecting}
          />
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}

        <div className="flex justify-end space-x-3">
          {onClose && (
            <button
              onClick={onClose}
              disabled={isConnecting}
              className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleConnect}
            disabled={!connectionString.trim() || isConnecting}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isConnecting ? "Connecting..." : "Connect"}
          </button>
        </div>

        {dbStatus === "initializing" && (
          <div className="mt-4 text-center text-gray-600">
            <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
            Connecting to device...
          </div>
        )}
      </div>
    </div>
  );
}
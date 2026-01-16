import React, { useState, useEffect, useRef } from "react";
import { Html5QrcodeScanner, Html5Qrcode } from "html5-qrcode";
import { useDbQuery } from "../hooks/dbQuery";
import { isMobileDevice, hasCameraAccess } from "../lib/mobile-utils";

interface ConnectDeviceDialogProps {
  onClose?: () => void;
}

export function ConnectDeviceDialog({ onClose }: ConnectDeviceDialogProps) {
  const { connectDevice, dbStatus, error } = useDbQuery();
  const [connectionString, setConnectionString] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [hasCamera, setHasCamera] = useState(false);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);

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

  useEffect(() => {
    const checkMobileAndCamera = async () => {
      const mobile = isMobileDevice();
      setIsMobile(mobile);
      
      if (mobile) {
        const camera = await hasCameraAccess();
        setHasCamera(camera);
      }
    };
    
    checkMobileAndCamera();

    // Cleanup scanner on unmount
    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear();
      }
      if (html5QrCodeRef.current) {
        html5QrCodeRef.current.stop().catch(console.error);
      }
    };
  }, []);

  const startQrScanner = () => {
    setIsScanning(true);
  };

  useEffect(() => {
    if (isScanning) {
      // Wait for the component to re-render with the qr-reader element
      const initializeScanner = async () => {
        try {
          const html5QrCode = new Html5Qrcode("qr-reader");
          html5QrCodeRef.current = html5QrCode;

          await html5QrCode.start(
            { facingMode: "environment" }, // Use back camera
            {
              fps: 10,
              qrbox: { width: 250, height: 250 }
            },
            (decodedText) => {
              // QR code successfully scanned
              setConnectionString(decodedText);
              stopQrScanner();
            },
            () => {
              // QR scan callback is called frequently when no QR code in frame
              // This is expected behavior and should be silent
            }
          );
        } catch (err) {
          console.error("Failed to start QR scanner:", err);
          setIsScanning(false);
        }
      };

      // Small delay to ensure DOM element is available
      const timeoutId = setTimeout(initializeScanner, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [isScanning]);

  const stopQrScanner = () => {
    if (html5QrCodeRef.current) {
      html5QrCodeRef.current.stop()
        .then(() => {
          html5QrCodeRef.current = null;
          setIsScanning(false);
        })
        .catch(console.error);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isConnecting) {
      handleConnect();
    }
  };

  if (isScanning) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
          <h2 className="text-xl font-semibold mb-4">Scan QR Code</h2>
          
          <p className="text-gray-600 mb-4">
            Point your camera at the QR code from your main device.
          </p>

          <div id="qr-reader" className="w-full mb-4"></div>

          <div className="flex justify-end space-x-3">
            <button
              onClick={stopQrScanner}
              className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

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

        <div className="flex flex-col items-center space-y-3 mb-4">
          {isMobile && hasCamera && (
            <button
              onClick={startQrScanner}
              disabled={isConnecting}
              className="w-full px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
            >
              <span>📷</span>
              <span>Scan QR Code</span>
            </button>
          )}
          <button
            onClick={handleConnect}
            disabled={!connectionString.trim() || isConnecting}
            className="w-full px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
          >
            <span>🔗</span>
            <span>{isConnecting ? "Connecting..." : "Connect"}</span>
          </button>
        </div>

        <div className="flex justify-end">
          {onClose && (
            <button
              onClick={onClose}
              disabled={isConnecting}
              className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
          )}
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
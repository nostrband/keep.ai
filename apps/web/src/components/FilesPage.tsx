import React, { useState, useRef, useMemo } from "react";
import { useFiles } from "../hooks/dbFileReads";
import { useNostrPeers, useLocalSiteId } from "../hooks/dbNostrPeerReads";
import { useQueryProvider } from "../QueryProviderEmbedded";
import SharedHeader from "./SharedHeader";
import { Button, Progress, Badge } from "../ui";
import { API_ENDPOINT } from "../const";
import { DEFAULT_RELAYS, FileSender, getStreamFactory } from "@app/sync";
import { getDefaultCompression } from "@app/browser";
import { SimplePool, getPublicKey } from "nostr-tools";
import { hexToBytes } from "nostr-tools/utils";
import { ServerlessNostrSigner } from "../lib/signer";

declare const __SERVERLESS__: boolean;
const isServerless = __SERVERLESS__;

const ALLOWED_FILE_TYPES = [
  'image/*',
  'text/*',
  'audio/*',
  'application/pdf',
  'application/json',
  'application/zip',
  '.txt',
  '.md',
  '.csv',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx'
];

// File size formatter
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Get file icon based on media type
const getFileIcon = (mediaType: string = '', fileName: string = '') => {
  if (mediaType.startsWith('image/')) {
    return (
      <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    );
  }
  if (mediaType.startsWith('text/') || fileName.endsWith('.txt') || fileName.endsWith('.md')) {
    return (
      <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  }
  if (mediaType === 'application/pdf' || fileName.endsWith('.pdf')) {
    return (
      <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    );
  }
  // Default file icon
  return (
    <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
};

// Helper function to determine if file should use no compression
const shouldUseNoCompression = (fileName: string): boolean => {
  const extension = fileName.toLowerCase().split('.').pop();
  if (!extension) return false;
  
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'tiff', 'ico', 'heic', 'heif'];
  const audioExtensions = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus'];
  const videoExtensions = ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm', 'm4v', 'ogv'];
  
  return imageExtensions.includes(extension) ||
         audioExtensions.includes(extension) ||
         videoExtensions.includes(extension);
};

export default function FilesPage() {
  const { data: files = [], isLoading, refetch } = useFiles();
  const { data: allNostrPeers = [] } = useNostrPeers();
  const { data: localSiteId } = useLocalSiteId();
  const queryProvider = useQueryProvider();
  
  // Filter peers by local_id (same logic as server.ts)
  const nostrPeers = useMemo(() => {
    if (!localSiteId) return [];
    return allNostrPeers.filter((p) => p.local_id === localSiteId);
  }, [allNostrPeers, localSiteId]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [downloadingFiles, setDownloadingFiles] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = () => {
    fileInputRef.current?.click();
  };

  // Create async iterable from file for FileSender
  async function* createFileDataSource(file: File): AsyncIterable<Uint8Array> {
    const chunkSize = 64 * 1024; // 64KB chunks
    let offset = 0;
    
    while (offset < file.size) {
      const chunk = file.slice(offset, offset + chunkSize);
      const arrayBuffer = await chunk.arrayBuffer();
      yield new Uint8Array(arrayBuffer);
      offset += chunkSize;
      
      // Update progress
      const progress = Math.min((offset / file.size) * 100, 100);
      setUploadProgress(progress);
    }
  }

  // Serverless upload using FileSender
  const uploadFileServerless = async (file: File) => {
    try {
      // Check if we have exactly one peer
      if (nostrPeers.length !== 1) {
        throw new Error(`Expected 1 peer, found ${nostrPeers.length}`);
      }

      const peer = nostrPeers[0];
      
      // Get local private key from localStorage
      const localKey = localStorage.getItem("local_key");
      if (!localKey) {
        throw new Error("No local key found");
      }

      const localPrivkey = hexToBytes(localKey);
      const localPubkey = getPublicKey(localPrivkey);
      const peerPubkey = peer.peer_pubkey;

      // Create signer
      const signer = new ServerlessNostrSigner();
      signer.setKey(localPrivkey);

      // Create pool
      const pool = new SimplePool({
        enablePing: false,
        enableReconnect: true
      });

      // Create stream factory
      const factory = getStreamFactory();
      factory.compression = getDefaultCompression();

      // Determine compression based on file type
      const compression = shouldUseNoCompression(file.name) ? 'none' : 'gzip';

      // Create FileSender
      const fileSender = new FileSender({
        signer,
        pool,
        factory,
        compression,
        encryption: 'nip44_v3',
        localPubkey,
        peerPubkey,
        relays: DEFAULT_RELAYS
      });

      // Start FileSender without onDownload callback
      fileSender.start();

      try {
        // Create file data source
        const source = createFileDataSource(file);
        
        // Upload file (without downloadId for direct upload)
        await fileSender.upload({ filename: file.name }, source);
        
        // Refresh file list
        refetch();
        
      } finally {
        // Clean up
        fileSender.stop();
        pool.destroy();
      }
      
    } catch (error) {
      console.error("Serverless upload failed:", error);
      throw error;
    }
  };

  // Regular upload using API
  const uploadFileAPI = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    
    // Track upload progress
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const progress = (event.loaded / event.total) * 100;
        setUploadProgress(progress);
      }
    };

    return new Promise<void>((resolve, reject) => {
      // Handle response
      xhr.onload = () => {
        if (xhr.status === 200) {
          // Upload successful, refresh the file list
          refetch();
          setUploadProgress(100);
          setTimeout(() => {
            setIsUploading(false);
            setUploadProgress(0);
          }, 1000);
          resolve();
        } else {
          try {
            const errorResponse = JSON.parse(xhr.responseText);
            reject(new Error(errorResponse.error || 'Upload failed'));
          } catch {
            reject(new Error('Upload failed with status: ' + xhr.status));
          }
        }
      };

      xhr.onerror = () => {
        reject(new Error('Network error during upload'));
      };

      // Start the upload
      xhr.open('POST', `${API_ENDPOINT}/file/upload`);
      xhr.send(formData);
    });
  };

  // Unified file upload function
  const uploadFile = async (file: File) => {
    // Reset states
    setUploadError(null);
    setIsUploading(true);
    setUploadProgress(0);

    try {
      if (isServerless) {
        await uploadFileServerless(file);
      } else {
        await uploadFileAPI(file);
      }
      
      // Success
      setUploadProgress(100);
      setTimeout(() => {
        setIsUploading(false);
        setUploadProgress(0);
      }, 1000);
      
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Unknown error');
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    await uploadFile(file);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Drag and drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set dragover to false if we're leaving the drop zone entirely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    const file = files[0]; // Take only the first file

    if (!file) return;

    // Check if file type is allowed
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
    const isAllowed = ALLOWED_FILE_TYPES.some(type =>
      type === fileExtension ||
      file.type.startsWith(type.replace('/*', '')) ||
      type === 'text/*' && file.type.startsWith('text/')
    );

    if (!isAllowed) {
      setUploadError(`File type not allowed. Allowed types: ${ALLOWED_FILE_TYPES.join(', ')}`);
      return;
    }

    await uploadFile(file);
  };

  const handleDownload = async (fileId: string, fileName: string) => {
    // Set downloading state
    setDownloadingFiles(prev => new Set(prev).add(fileId));
    
    try {
      // Use service worker route that will handle API or nostr routing
      const response = await fetch(`/files/get/${fileId}`);
      if (!response.ok) {
        throw new Error('Failed to download file');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(link);
    } catch (error) {
      console.error('Download failed:', error);
      alert('Failed to download file');
    } finally {
      // Clear downloading state
      setDownloadingFiles(prev => {
        const newSet = new Set(prev);
        newSet.delete(fileId);
        return newSet;
      });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader title="Files" />

      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* Upload Section */}
        <div
          className={`mb-6 p-6 bg-white rounded-lg border-2 border-dashed transition-colors ${
            isDragOver
              ? 'border-blue-400 bg-blue-50'
              : 'border-gray-300 hover:border-gray-400'
          }`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <div className="text-center">
            <div className={`mx-auto mb-4 ${isDragOver ? 'scale-110' : ''} transition-transform`}>
              <svg className="w-12 h-12 text-gray-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            
            {isDragOver ? (
              <div className="text-blue-600 font-medium">
                <p className="text-lg">Drop your file here!</p>
                <p className="text-sm mt-1">Release to upload</p>
              </div>
            ) : (
              <div>
                <h2 className="text-lg font-medium text-gray-900 mb-2">Upload File</h2>
                <p className="text-gray-600 mb-4">
                  Drag and drop a file here, or click to select
                </p>
                <Button
                  onClick={handleFileSelect}
                  disabled={isUploading}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {isUploading ? 'Uploading...' : 'Select File'}
                </Button>
                <p className="text-xs text-gray-500 mt-2">
                  Supported: Images, Documents, PDFs, Text files
                </p>
              </div>
            )}
          </div>
          
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileChange}
            accept={ALLOWED_FILE_TYPES.join(',')}
          />
          
          {isUploading && (
            <div className="mt-4">
              <div className="flex justify-between text-sm text-gray-600 mb-2">
                <span>Uploading...</span>
                <span>{Math.round(uploadProgress)}%</span>
              </div>
              <Progress value={uploadProgress} className="h-2" />
            </div>
          )}
          
          {uploadError && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600">{uploadError}</p>
            </div>
          )}
        </div>

        {/* Files List */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">
              Files ({files.length})
            </h2>
          </div>
          
          {isLoading ? (
            <div className="p-6 text-center">
              <div>Loading files...</div>
            </div>
          ) : files.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-gray-500">No files found</p>
              <p className="text-sm text-gray-400 mt-2">
                Upload a file to get started
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {files.map((file) => (
                <div key={file.id} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                      <div className="flex-shrink-0">
                        {getFileIcon(file.media_type, file.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-sm font-medium text-gray-900 truncate">
                            {file.name}
                          </h3>
                          {file.media_type && (
                            <Badge variant="outline" className="text-xs">
                              {file.media_type.split('/')[0]}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-gray-500">
                          <span>{formatFileSize(file.size)}</span>
                          <span>
                            {new Date(file.upload_time).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        </div>
                        {file.summary && (
                          <p className="text-xs text-gray-600 mt-1 line-clamp-1">
                            {file.summary}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="ml-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDownload(file.id, file.name)}
                        disabled={downloadingFiles.has(file.id)}
                        className="h-8 px-3"
                      >
                        {downloadingFiles.has(file.id) ? (
                          <>
                            <svg className="w-4 h-4 mr-1 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Downloading...
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            Download
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
import fs from "fs";
import path from "path";

export interface FileStats {
  size: number;
  isFile(): boolean;
  isDirectory(): boolean;
}

export interface FileReadResult {
  bytesRead: number;
  buffer: Uint8Array;
}

export const fileUtils = {
  // Path utilities
  basename: (filePath: string, ext?: string) => path.basename(filePath, ext),
  extname: (filePath: string) => path.extname(filePath),
  join: (...paths: string[]) => path.join(...paths),
  
  // File system utilities
  existsSync: (filePath: string) => fs.existsSync(filePath),
  
  openSync: (filePath: string, flags: string) => fs.openSync(filePath, flags),
  
  closeSync: (fd: number) => fs.closeSync(fd),
  
  fstatSync: (fd: number): FileStats => {
    const stats = fs.fstatSync(fd);
    return {
      size: stats.size,
      isFile: () => stats.isFile(),
      isDirectory: () => stats.isDirectory(),
    };
  },
  
  readSync: (fd: number, buffer: Uint8Array, offset: number, length: number, position: number): number => {
    return fs.readSync(fd, buffer, offset, length, position);
  },
  
  // Buffer/encoding utilities
  bufferToBase64: (buffer: Uint8Array) => Buffer.from(buffer).toString('base64'),
  
  allocBuffer: (size: number) => new Uint8Array(size),
};
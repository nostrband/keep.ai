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
  
  writeSync: (fd: number, buffer: Uint8Array, offset: number, length: number, position?: number): number => {
    return fs.writeSync(fd, buffer, offset, length, position);
  },

  writeFileSync: (filePath: string, data: string | Uint8Array, encoding?: BufferEncoding) => {
    fs.writeFileSync(filePath, data, encoding);
  },

  mkdirSync: (dirPath: string, options?: fs.MakeDirectoryOptions) => {
    fs.mkdirSync(dirPath, options);
  },

  readFileSync: (filePath: string, encoding?: BufferEncoding): string | Buffer => {
    return fs.readFileSync(filePath, encoding);
  },

  // Buffer/encoding utilities
  bufferToBase64: (buffer: Uint8Array) => Buffer.from(buffer).toString('base64'),
  
  allocBuffer: (size: number) => new Uint8Array(size),
};
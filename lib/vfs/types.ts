export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  settings: {
    defaultTemplate?: string;
    globalStyles?: string;
  };
  lastSavedCheckpointId?: string | null;
  lastSavedAt?: Date | null;
  costTracking?: {
    totalCost: number;
    providerBreakdown: Record<string, {
      totalCost: number;
      tokenUsage: {
        input: number;
        output: number;
        reasoning?: number;
        cached?: number;
      };
      requestCount: number;
      lastUpdated: Date;
    }>;
    sessionHistory?: Array<{
      sessionId: string;
      cost: number;
      provider: string;
      timestamp: Date;
      tokenUsage?: {
        input: number;
        output: number;
      };
      correction?: boolean;
    }>;
  };
}

export interface VirtualFile {
  id: string;
  projectId: string;
  path: string;
  name: string;
  type: 'html' | 'css' | 'js' | 'json' | 'text' | 'image' | 'video' | 'binary';
  content: string | ArrayBuffer;
  mimeType: string;
  size: number;
  createdAt: Date;
  updatedAt: Date;
  metadata: {
    isEntry?: boolean;
    dependencies?: string[];
  };
}

export interface FileTreeNode {
  id: string;
  projectId: string;
  path: string;
  type: 'directory' | 'file';
  parentPath: string | null;
  children?: string[];
}

export interface FileOperation {
  projectId: string;
  path: string;
  content?: string | ArrayBuffer;
  newPath?: string;
}

export interface PatchOperation {
  search: string;
  replace: string;
}

export type FileType = VirtualFile['type'];

export const MIME_TYPES: Record<FileType, string> = {
  html: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  json: 'application/json',
  text: 'text/plain',
  image: 'image/*',
  video: 'video/*',
  binary: 'application/octet-stream'
};

export const SUPPORTED_EXTENSIONS = {
  html: ['html', 'htm'],
  css: ['css'],
  js: ['js', 'mjs', 'jsx'],
  json: ['json'],
  text: ['txt', 'md', 'xml', 'svg'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp'],
  video: ['mp4', 'webm', 'ogg']
};

export const FILE_SIZE_LIMITS = {
  text: 5 * 1024 * 1024,
  html: 5 * 1024 * 1024,
  css: 5 * 1024 * 1024,
  js: 5 * 1024 * 1024,
  json: 5 * 1024 * 1024,
  image: 10 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  binary: 10 * 1024 * 1024
};

export function getFileTypeFromPath(path: string): FileType {
  const ext = path.split('.').pop()?.toLowerCase();
  
  for (const [type, extensions] of Object.entries(SUPPORTED_EXTENSIONS)) {
    if (extensions.includes(ext || '')) {
      return type as FileType;
    }
  }
  
  return 'text';
}

export function getSpecificMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  
  const mimeMap: Record<string, string> = {
    'html': 'text/html',
    'htm': 'text/html',
    
    'css': 'text/css',
    
    'js': 'application/javascript',
    'mjs': 'application/javascript',
    'jsx': 'application/javascript',
    
    'json': 'application/json',
    
    'txt': 'text/plain',
    'md': 'text/markdown',
    'xml': 'application/xml',
    'svg': 'image/svg+xml',
    
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'ico': 'image/x-icon',
    'bmp': 'image/bmp',
    
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    'ogg': 'video/ogg'
  };
  
  return mimeMap[ext || ''] || 'application/octet-stream';
}

export function isFileSupported(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase();
  for (const extensions of Object.values(SUPPORTED_EXTENSIONS)) {
    if (extensions.includes(ext || '')) {
      return true;
    }
  }
  return false;
}

export function getMimeType(type: FileType): string {
  return MIME_TYPES[type];
}

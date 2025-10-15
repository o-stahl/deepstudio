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
  previewImage?: string; // base64 data URL of project preview
  previewUpdatedAt?: Date; // when the preview was last captured
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
  type: 'html' | 'css' | 'js' | 'json' | 'text' | 'template' | 'image' | 'video' | 'binary';
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
  template: 'text/x-handlebars-template',
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
  template: ['hbs', 'handlebars'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp'],
  video: ['mp4', 'webm', 'ogg']
};

export const FILE_SIZE_LIMITS = {
  text: 5 * 1024 * 1024,
  html: 5 * 1024 * 1024,
  css: 5 * 1024 * 1024,
  js: 5 * 1024 * 1024,
  json: 5 * 1024 * 1024,
  template: 5 * 1024 * 1024,
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
    
    'hbs': 'text/x-handlebars-template',
    'handlebars': 'text/x-handlebars-template',
    
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

// Template System Types

export interface CustomTemplate {
  id: string;
  name: string;
  description: string;
  version: string;
  files: Array<{path: string; content: string | ArrayBuffer}>;
  directories: string[];
  assets?: Array<{
    filename: string;
    path: string;
  }>;
  metadata: {
    author?: string;
    authorUrl?: string;
    license: string;              // Required, defaults to "personal"
    licenseLabel?: string;        // For custom licenses
    licenseDescription?: string;  // For custom licenses
    tags?: string[];
    thumbnail?: string;           // Base64 data URL
    previewImages?: string[];     // Array of base64 images
    downloadUrl?: string;
  };
  importedAt: Date;
  updatedAt?: Date;
}

export interface LicenseOption {
  value: string;
  label: string;
  description: string;
}

export const LICENSE_OPTIONS: LicenseOption[] = [
  {
    value: 'personal',
    label: 'Personal Use Only',
    description: 'Cannot be resold or used commercially'
  },
  {
    value: 'commercial',
    label: 'Commercial Use',
    description: 'Can be used in commercial projects, cannot resell template'
  },
  {
    value: 'mit',
    label: 'MIT License',
    description: 'Use freely, must include copyright notice'
  },
  {
    value: 'apache-2.0',
    label: 'Apache 2.0',
    description: 'Similar to MIT, with patent protection'
  },
  {
    value: 'gpl-3.0',
    label: 'GPL 3.0',
    description: 'Open source, derivatives must also be GPL'
  },
  {
    value: 'bsd-3-clause',
    label: 'BSD 3-Clause',
    description: 'Permissive, cannot use author name for promotion'
  },
  {
    value: 'cc-by-4.0',
    label: 'CC BY 4.0',
    description: 'Free use with attribution'
  },
  {
    value: 'cc-by-sa-4.0',
    label: 'CC BY-SA 4.0',
    description: 'Free use with attribution, share-alike'
  },
  {
    value: 'cc-by-nc-4.0',
    label: 'CC BY-NC 4.0',
    description: 'Free for non-commercial use with attribution'
  },
  {
    value: 'unlicense',
    label: 'Unlicense (Public Domain)',
    description: 'No restrictions, completely free to use'
  },
  {
    value: 'all-rights-reserved',
    label: 'All Rights Reserved',
    description: 'Most restrictive, requires explicit permission'
  },
  {
    value: 'custom',
    label: 'Custom License',
    description: 'Specify your own terms'
  }
];

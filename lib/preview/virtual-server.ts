import { VirtualFileSystem } from '../vfs';
import { VirtualFile } from '../vfs/types';
import { ProcessedFile, Route, CompiledProject } from './types';

export class VirtualServer {
  private vfs: VirtualFileSystem;
  private projectId: string;
  private baseUrl: string;
  private blobUrls: Map<string, string> = new Map();
  private fileHashes: Map<string, string> = new Map();

  constructor(vfs: VirtualFileSystem, projectId: string, existingBlobUrls?: Map<string, string>) {
    this.vfs = vfs;
    this.projectId = projectId;
    this.baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    if (existingBlobUrls) {
      this.blobUrls = new Map(existingBlobUrls);
    }
  }

  async compileProject(incrementalUpdate = false): Promise<CompiledProject> {
    const files = await this.vfs.listDirectory(this.projectId, '/');
    
    const oldBlobUrls = new Map(this.blobUrls);
    const newBlobUrls = new Map<string, string>();
    const rawProcessedFiles: ProcessedFile[] = [];
    
    for (const file of files) {
      let processedFile: ProcessedFile;
      
      if (file.type === 'image' || file.type === 'video') {
        processedFile = {
          path: file.path,
          content: file.content,
          mimeType: file.mimeType
        };
      } else if (file.type === 'html') {
        processedFile = await this.processHTML(file);
      } else if (file.type === 'js') {
        processedFile = await this.processJS(file);
      } else if (file.type !== 'css') {
        processedFile = {
          path: file.path,
          content: file.content as string,
          mimeType: file.mimeType
        };
      } else {
        continue;
      }
      
      const contentHash = this.hashContent(processedFile.content);
      const previousHash = this.fileHashes.get(processedFile.path);
      
      if (incrementalUpdate && previousHash === contentHash && oldBlobUrls.has(processedFile.path)) {
        const existingUrl = oldBlobUrls.get(processedFile.path)!;
        newBlobUrls.set(processedFile.path, existingUrl);
        processedFile.blobUrl = existingUrl;
        oldBlobUrls.delete(processedFile.path);
      } else {
        const blob = new Blob([processedFile.content], { type: processedFile.mimeType });
        const blobUrl = URL.createObjectURL(blob);
        newBlobUrls.set(processedFile.path, blobUrl);
        processedFile.blobUrl = blobUrl;
        this.fileHashes.set(processedFile.path, contentHash);
      }
      
      rawProcessedFiles.push(processedFile);
    }
    
    const processedFiles = [...rawProcessedFiles];
    for (const file of files) {
      if (file.type === 'css') {
        const processedFile = await this.processCSS(file, newBlobUrls);
        
        const contentHash = this.hashContent(processedFile.content);
        const previousHash = this.fileHashes.get(processedFile.path);
        
        if (incrementalUpdate && previousHash === contentHash && oldBlobUrls.has(processedFile.path)) {
          const existingUrl = oldBlobUrls.get(processedFile.path)!;
          newBlobUrls.set(processedFile.path, existingUrl);
          processedFile.blobUrl = existingUrl;
          oldBlobUrls.delete(processedFile.path);
        } else {
          const blob = new Blob([processedFile.content], { type: processedFile.mimeType });
          const blobUrl = URL.createObjectURL(blob);
          newBlobUrls.set(processedFile.path, blobUrl);
          processedFile.blobUrl = blobUrl;
          this.fileHashes.set(processedFile.path, contentHash);
        }
        
        processedFiles.push(processedFile);
      }
    }
    
    const routes = this.generateRoutes(files);
    
    if (incrementalUpdate) {
      for (const [, url] of oldBlobUrls) {
        URL.revokeObjectURL(url);
      }
    } else if (!incrementalUpdate) {
      this.cleanupBlobUrls();
    }
    
    this.blobUrls = newBlobUrls;

    return {
      entryPoint: '/index.html',
      files: processedFiles,
      routes,
      blobUrls: this.blobUrls
    };
  }
  
  private hashContent(content: string | ArrayBuffer): string {
    let hash = 0;
    
    if (content instanceof ArrayBuffer) {
      const view = new Uint8Array(content);
      for (let i = 0; i < Math.min(view.length, 10000); i++) {
        hash = ((hash << 5) - hash) + view[i];
        hash = hash & hash;
      }
    } else {
      for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
    }
    
    return hash.toString(36);
  }

  private async processFiles(files: VirtualFile[]): Promise<ProcessedFile[]> {
    const processed: ProcessedFile[] = [];

    for (const file of files) {
      if (file.type === 'html') {
        processed.push(await this.processHTML(file));
      } else if (file.type === 'css') {
        processed.push(await this.processCSS(file, new Map()));
      } else if (file.type === 'js') {
        processed.push(await this.processJS(file));
      } else if (file.type === 'image' || file.type === 'video') {
        processed.push({
          path: file.path,
          content: file.content, // Can be ArrayBuffer or string
          mimeType: file.mimeType
        });
      } else {
        processed.push({
          path: file.path,
          content: file.content as string,
          mimeType: file.mimeType
        });
      }
    }

    return processed;
  }

  private async processHTML(file: VirtualFile): Promise<ProcessedFile> {
    let content = file.content as string;

    content = await this.processInternalReferences(content);

    return {
      path: file.path,
      content,
      mimeType: file.mimeType
    };
  }

  private async processCSS(file: VirtualFile, blobUrls: Map<string, string>): Promise<ProcessedFile> {
    let content = file.content as string;

    content = await this.processUrlReferences(content, blobUrls);

    return {
      path: file.path,
      content,
      mimeType: file.mimeType
    };
  }

  private async processJS(file: VirtualFile): Promise<ProcessedFile> {
    const content = file.content as string;


    return {
      path: file.path,
      content,
      mimeType: file.mimeType
    };
  }

  private async processInternalReferences(content: string): Promise<string> {
    const files = await this.vfs.listDirectory(this.projectId, '/');
    
    const patterns = [
      /href="([^"]+)"/g,
      /src="([^"]+)"/g,
      /href='([^']+)'/g,
      /src='([^']+)'/g
    ];

    let processed = content;
    for (const pattern of patterns) {
      processed = processed.replace(pattern, (match, url) => {
        if (url.startsWith('http') || url.startsWith('data:') || url.startsWith('//')) {
          return match;
        }

        const normalizedPath = this.normalizePath(url);
        
        const fileExists = files.some(f => f.path === normalizedPath);
        if (fileExists) {
          return match;
        }

        return match;
      });
    }

    return processed;
  }

  private async processUrlReferences(content: string, blobUrls: Map<string, string>): Promise<string> {
    return content.replace(/url\(['"]?([^'")]+)['"]?\)/g, (match, url) => {
      if (url.startsWith('http') || url.startsWith('data:') || url.startsWith('//') || url.startsWith('blob:')) {
        return match;
      }

      const normalizedPath = this.normalizePath(url);
      
      const blobUrl = blobUrls.get(normalizedPath);
      if (blobUrl) {
        return `url('${blobUrl}')`;
      }

      return match;
    });
  }

  private normalizePath(path: string): string {
    if (path.startsWith('./')) {
      path = path.slice(2);
    }

    if (!path.startsWith('/')) {
      path = '/' + path;
    }

    if (!path.includes('.') && !path.endsWith('/')) {
      const htmlPath = path + '.html';
      return htmlPath;
    }

    return path;
  }

  private generateRoutes(files: VirtualFile[]): Route[] {
    const htmlFiles = files.filter(f => f.type === 'html');
    
    return htmlFiles.map(file => {
      const content = file.content as string;
      const titleMatch = content.match(/<title>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1] : file.name.replace('.html', '');

      const routePath = file.path.replace('.html', '') || '/';

      return {
        path: routePath === '/index' ? '/' : routePath,
        file: file.path,
        title
      };
    });
  }

  private extractTitle(content: string): string {
    const match = content.match(/<title>([^<]+)<\/title>/i);
    return match ? match[1] : 'Untitled Page';
  }

  cleanupBlobUrls(): void {
    for (const url of this.blobUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.blobUrls.clear();
  }

  async getCompiledFile(path: string): Promise<ProcessedFile | null> {
    try {
      const file = await this.vfs.readFile(this.projectId, path);
      
      if (file.type === 'html') {
        return await this.processHTML(file);
      } else if (file.type === 'css') {
        return await this.processCSS(file, new Map());
      } else if (file.type === 'js') {
        return await this.processJS(file);
      } else {
        return {
          path: file.path,
          content: file.content as string,
          mimeType: file.mimeType
        };
      }
    } catch {
      return null;
    }
  }
}

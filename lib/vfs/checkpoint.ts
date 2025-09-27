import { vfs } from './index';
import { logger } from '@/lib/utils';

export type CheckpointKind = 'auto' | 'manual' | 'system';

// File content can be either a string or base64-encoded binary data
interface CheckpointFileContent {
  data: string;
  encoding?: 'base64';
}

export interface Checkpoint {
  id: string;
  timestamp: string;
  description: string;
  files: Map<string, string | CheckpointFileContent>;
  directories: Set<string>;
  projectId: string;
  kind: CheckpointKind;
  baseRevisionId?: string | null;
}

// Serializable checkpoint format for storage
interface StoredCheckpoint {
  id: string;
  timestamp: string;
  description: string;
  files: [string, string | CheckpointFileContent][];
  directories: string[];
  projectId: string;
  kind?: CheckpointKind;
  baseRevisionId?: string | null;
}

interface CreateCheckpointOptions {
  kind?: CheckpointKind;
  baseRevisionId?: string | null;
  replaceId?: string | null;
}

export class CheckpointManager {
  private checkpoints: Map<string, Checkpoint> = new Map();
  private currentCheckpoint: string | null = null;
  private dbName = 'DeepStudioCheckpoints';
  private storeName = 'checkpoints';
  private db: IDBDatabase | null = null;
  private isInitialized = false;

  /**
   * Convert ArrayBuffer to base64 string
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Convert base64 string to ArrayBuffer
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
  
  /**
   * Initialize the IndexedDB database
   */
  private async initDB(): Promise<void> {
    if (this.isInitialized) return;
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      
      request.onerror = () => {
        logger.error('Failed to open checkpoint database');
        reject(request.error);
      };
      
      request.onsuccess = () => {
        this.db = request.result;
        this.isInitialized = true;
        this.loadCheckpointsFromDB().then(() => resolve());
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('projectId', 'projectId', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }
  
  /**
   * Load checkpoints from IndexedDB into memory
   */
  private async loadCheckpointsFromDB(): Promise<void> {
    if (!this.db) return;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();
      
      request.onsuccess = () => {
        const storedCheckpoints = request.result as StoredCheckpoint[];
        this.checkpoints.clear();
        
        for (const stored of storedCheckpoints) {
          const checkpoint: Checkpoint = {
            ...stored,
            kind: stored.kind || 'auto',
            baseRevisionId: stored.baseRevisionId ?? null,
            files: new Map(stored.files),
            directories: new Set(stored.directories)
          };
          this.checkpoints.set(checkpoint.id, checkpoint);
        }
        
        resolve();
      };
      
      request.onerror = () => {
        logger.error('Failed to load checkpoints from DB');
        reject(request.error);
      };
    });
  }
  
  /**
   * Save a checkpoint to IndexedDB
   */
  private async saveCheckpointToDB(checkpoint: Checkpoint): Promise<void> {
    await this.initDB();
    if (!this.db) return;
    
    const storedCheckpoint: StoredCheckpoint = {
      ...checkpoint,
      files: Array.from(checkpoint.files.entries()),
      directories: Array.from(checkpoint.directories),
      kind: checkpoint.kind,
      baseRevisionId: checkpoint.baseRevisionId ?? null
    };
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(storedCheckpoint);
      
      request.onsuccess = () => resolve();
      request.onerror = () => {
        logger.error('Failed to save checkpoint to DB');
        reject(request.error);
      };
    });
  }
  
  /**
   * Delete a checkpoint from IndexedDB
   */
  private async deleteCheckpointFromDB(checkpointId: string): Promise<void> {
    await this.initDB();
    if (!this.db) return;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(checkpointId);
      
      request.onsuccess = () => resolve();
      request.onerror = () => {
        logger.error('Failed to delete checkpoint from DB');
        reject(request.error);
      };
    });
  }
  
  /**
   * Create a checkpoint of current project state
   */
  async createCheckpoint(
    projectId: string,
    description: string,
    options: CreateCheckpointOptions = {}
  ): Promise<Checkpoint> {
    await this.initDB();
    await vfs.init();
    
    const files = await vfs.listDirectory(projectId, '/');
    const fileContents = new Map<string, string | CheckpointFileContent>();
    const directories = new Set<string>();
    
    for (const file of files) {
      const pathParts = file.path.split('/').filter(Boolean);
      for (let i = 1; i <= pathParts.length - 1; i++) {
        const dirPath = '/' + pathParts.slice(0, i).join('/');
        directories.add(dirPath);
      }
      
      if (typeof file.content === 'string') {
        fileContents.set(file.path, file.content);
      } else if (file.content instanceof ArrayBuffer) {
        // Convert ArrayBuffer to base64 for storage
        const base64Data = this.arrayBufferToBase64(file.content);
        fileContents.set(file.path, {
          data: base64Data,
          encoding: 'base64'
        });
      } else {
        // Try to read the full file if content is not available
        try {
          const fullFile = await vfs.readFile(projectId, file.path);
          if (typeof fullFile.content === 'string') {
            fileContents.set(file.path, fullFile.content);
          } else if (fullFile.content instanceof ArrayBuffer) {
            const base64Data = this.arrayBufferToBase64(fullFile.content);
            fileContents.set(file.path, {
              data: base64Data,
              encoding: 'base64'
            });
          }
        } catch (error) {
          logger.error(`Failed to read file for checkpoint: ${file.path}`, error);
        }
      }
    }
    
    const checkpoint: Checkpoint = {
      id: `cp_${Date.now()}`,
      timestamp: new Date().toISOString(),
      description,
      files: fileContents,
      directories,
      projectId,
      kind: options.kind || 'auto',
      baseRevisionId: options.baseRevisionId ?? null
    };

    if (options.replaceId) {
      this.checkpoints.delete(options.replaceId);
      await this.deleteCheckpointFromDB(options.replaceId);
    }

    if (checkpoint.kind === 'manual') {
      const existingManual = Array.from(this.checkpoints.values()).find(
        (cp) => cp.projectId === projectId && cp.kind === 'manual'
      );
      if (existingManual && existingManual.id !== options.replaceId) {
        this.checkpoints.delete(existingManual.id);
        await this.deleteCheckpointFromDB(existingManual.id);
      }
    }

    this.checkpoints.set(checkpoint.id, checkpoint);
    this.currentCheckpoint = checkpoint.id;

    // Persist to IndexedDB
    await this.saveCheckpointToDB(checkpoint);

    // Clean up old auto checkpoints (keep last 10 by timestamp)
    const autoCheckpoints = Array.from(this.checkpoints.values())
      .filter(cp => cp.projectId === projectId && cp.kind === 'auto')
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (autoCheckpoints.length > 10) {
      const toDelete = autoCheckpoints.slice(0, autoCheckpoints.length - 10);
      for (const cp of toDelete) {
        this.checkpoints.delete(cp.id);
        await this.deleteCheckpointFromDB(cp.id);
      }
    }

    return checkpoint;
  }
  
  /**
   * Restore project to a checkpoint
   */
  async restoreCheckpoint(checkpointId: string): Promise<boolean> {
    // Defensive check: ensure checkpointId is a string
    if (typeof checkpointId !== 'string') {
      logger.error('[Checkpoint] Invalid checkpoint ID type:', typeof checkpointId, checkpointId);
      return false;
    }
    
    // Basic validation of checkpoint ID format
    if (!checkpointId.startsWith('cp_') || checkpointId.length < 6) {
      logger.error('[Checkpoint] Invalid checkpoint ID format:', checkpointId);
      return false;
    }
    
    await this.initDB();
    
    let checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) {
      // Try to load from IndexedDB if not in memory
      await this.loadCheckpointsFromDB();
      checkpoint = this.checkpoints.get(checkpointId);
      if (!checkpoint) {
        logger.error(`[Checkpoint] Checkpoint not found in database: ${checkpointId}`);
        // List available checkpoints for debugging
        const available = Array.from(this.checkpoints.keys());
        return false;
      }
    }
    
    await vfs.init();
    
    try {
      const currentFiles = await vfs.listDirectory(checkpoint.projectId, '/');
      
      const currentDirs = new Set<string>();
      for (const file of currentFiles) {
        const pathParts = file.path.split('/').filter(Boolean);
        for (let i = 1; i <= pathParts.length - 1; i++) {
          const dirPath = '/' + pathParts.slice(0, i).join('/');
          currentDirs.add(dirPath);
        }
      }
      
      for (const file of currentFiles) {
        if (!checkpoint.files.has(file.path)) {
          await vfs.deleteFile(checkpoint.projectId, file.path);
        }
      }
      
      const dirsToDelete = Array.from(currentDirs)
        .filter(dir => !checkpoint.directories || !checkpoint.directories.has(dir))
        .sort((a, b) => b.length - a.length);
      
      for (const dir of dirsToDelete) {
        try {
          await vfs.deleteDirectory(checkpoint.projectId, dir);
        } catch {
        }
      }
      
      if (checkpoint.directories) {
        const dirsToCreate = Array.from(checkpoint.directories)
          .sort((a, b) => a.length - b.length);
        
        for (const dir of dirsToCreate) {
          if (!currentDirs.has(dir)) {
            try {
              await vfs.createDirectory(checkpoint.projectId, dir);
            } catch {
            }
          }
        }
      }
      
      for (const [path, content] of checkpoint.files) {
        let actualContent: string | ArrayBuffer;
        
        // Check if content is base64-encoded binary data
        if (typeof content === 'object' && content.encoding === 'base64') {
          actualContent = this.base64ToArrayBuffer(content.data);
        } else {
          actualContent = content as string;
        }
        
        const exists = currentFiles.some(f => f.path === path);
        if (exists) {
          await vfs.updateFile(checkpoint.projectId, path, actualContent);
        } else {
          await vfs.createFile(checkpoint.projectId, path, actualContent);
        }
      }
      
      this.currentCheckpoint = checkpointId;
      return true;
    } catch (error) {
      logger.error('Failed to restore checkpoint:', error);
      return false;
    }
  }
  
  /**
   * Get all checkpoints for a project
   */
  async getCheckpoints(projectId: string): Promise<Checkpoint[]> {
    await this.initDB();
    await this.loadCheckpointsFromDB();
    
    return Array.from(this.checkpoints.values())
      .filter(cp => cp.projectId === projectId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }
  
  /**
   * Get the current checkpoint
   */
  getCurrentCheckpoint(): Checkpoint | null {
    if (!this.currentCheckpoint) return null;
    return this.checkpoints.get(this.currentCheckpoint) || null;
  }
  
  /**
   * Check if a checkpoint exists
   */
  async checkpointExists(checkpointId: string): Promise<boolean> {
    if (!checkpointId || typeof checkpointId !== 'string') {
      return false;
    }
    
    await this.initDB();
    
    // Check memory first
    if (this.checkpoints.has(checkpointId)) {
      return true;
    }
    
    // Check database
    await this.loadCheckpointsFromDB();
    return this.checkpoints.has(checkpointId);
  }

  /**
   * Clear all checkpoints for a project
   */
  async clearCheckpoints(projectId: string): Promise<void> {
    await this.initDB();
    
    const toDelete: string[] = [];
    for (const [id, checkpoint] of this.checkpoints) {
      if (checkpoint.projectId === projectId) {
        this.checkpoints.delete(id);
        toDelete.push(id);
      }
    }
    
    // Delete from IndexedDB
    for (const id of toDelete) {
      await this.deleteCheckpointFromDB(id);
    }
    
    this.currentCheckpoint = null;
  }
}

export const checkpointManager = new CheckpointManager();

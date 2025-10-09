import JSZip from 'jszip';
import { Project, VirtualFile } from './types';
import { ConversationState } from '@/lib/llm/conversation-state';
import { Checkpoint } from './checkpoint';
import { logger } from '@/lib/utils';

export interface BackupData {
  version: string;
  exportDate: string;
  databases: {
    vfs: {
      projects: Project[];
      files: VirtualFile[];
      fileTree: unknown[];
    };
    conversations: ConversationState[];
    checkpoints: Checkpoint[];
  };
  metadata: {
    projectCount: number;
    totalSize: number;
    exportedFrom: 'deepstudio' | 'oswstudio';
  };
}

export interface ImportOptions {
  mode: 'replace' | 'merge';
  onProgress?: (progress: number, message: string) => void;
}

export class BackupService {
  private static readonly BACKUP_VERSION = '1.9.0';
  private static readonly FILE_EXTENSION = '.osws';
  private static readonly MAX_IMPORT_SIZE = 100 * 1024 * 1024; // 100MB

  /**
   * Export all IndexedDB data to a downloadable backup file
   */
  static async exportAllData(): Promise<void> {
    try {
      logger.info('Starting data export...');

      const backupData: BackupData = {
        version: this.BACKUP_VERSION,
        exportDate: new Date().toISOString(),
        databases: {
          vfs: await this.exportUnifiedData(),
          conversations: [], // Legacy field, now part of unified export
          checkpoints: [], // Legacy field, now part of unified export
        },
        metadata: {
          projectCount: 0,
          totalSize: 0,
          exportedFrom: 'oswstudio',
        },
      };

      // Calculate metadata
      backupData.metadata.projectCount = backupData.databases.vfs.projects.length;
      backupData.metadata.totalSize = this.calculateDataSize(backupData);

      // Create compressed backup file
      const zip = new JSZip();
      zip.file('backup.json', JSON.stringify(backupData, null, 2));

      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });

      // Download the file
      const filename = `oswstudio-backup-${new Date().toISOString().split('T')[0]}${this.FILE_EXTENSION}`;
      this.downloadBlob(blob, filename);

      logger.info(`Export completed: ${backupData.metadata.projectCount} projects, ${this.formatBytes(backupData.metadata.totalSize)}`);
    } catch (error) {
      logger.error('Export failed:', error);
      throw new Error(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Import data from a backup file
   */
  static async importAllData(file: File, options: ImportOptions = { mode: 'merge' }): Promise<void> {
    try {
      // Validate file
      if (!file.name.endsWith(this.FILE_EXTENSION)) {
        throw new Error(`Invalid file type. Expected ${this.FILE_EXTENSION} file.`);
      }

      if (file.size > this.MAX_IMPORT_SIZE) {
        throw new Error(`File too large. Maximum size is ${this.formatBytes(this.MAX_IMPORT_SIZE)}.`);
      }

      options.onProgress?.(10, 'Reading backup file...');

      // Read and parse backup file
      const zip = new JSZip();
      const zipData = await zip.loadAsync(file);
      const backupFile = zipData.file('backup.json');
      
      if (!backupFile) {
        throw new Error('Invalid backup file format.');
      }

      const backupJson = await backupFile.async('string');
      const backupData: BackupData = JSON.parse(backupJson);

      // Validate backup data
      this.validateBackupData(backupData);

      options.onProgress?.(30, 'Validating backup data...');

      // Clear existing data if replace mode
      if (options.mode === 'replace') {
        options.onProgress?.(40, 'Clearing existing data...');

        // Close VFS database connection before deletion
        try {
          const { vfs } = await import('@/lib/vfs');
          if ((vfs as any).db?.db) {
            logger.info('[Backup] Closing VFS database before deletion');
            (vfs as any).db.db.close();
          }
        } catch (e) {
          logger.warn('[Backup] Could not close VFS database', e);
        }

        await this.clearAllData();
        // Wait for database deletion and browser cleanup
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Import data - handle both legacy (separate conversations/checkpoints) and new format
      options.onProgress?.(50, 'Importing all data...');

      // Merge conversations and checkpoints into vfsData if they exist separately (legacy format)
      const vfsDataWithAll = {
        ...backupData.databases.vfs,
        conversations: (backupData.databases.vfs as any).conversations || backupData.databases.conversations || [],
        checkpoints: (backupData.databases.vfs as any).checkpoints || backupData.databases.checkpoints || []
      };

      await this.importUnifiedData(vfsDataWithAll);

      options.onProgress?.(100, 'Import completed successfully!');
      
      logger.info(`Import completed: ${backupData.metadata.projectCount} projects restored`);
    } catch (error) {
      logger.error('Import failed:', error);
      throw new Error(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate if a file is a valid backup
   */
  static async validateBackupFile(file: File): Promise<{ valid: boolean; reason?: string; metadata?: BackupData['metadata'] }> {
    try {
      if (!file.name.endsWith(this.FILE_EXTENSION)) {
        return { valid: false, reason: 'Invalid file extension' };
      }

      if (file.size > this.MAX_IMPORT_SIZE) {
        return { valid: false, reason: 'File too large' };
      }

      const zip = new JSZip();
      const zipData = await zip.loadAsync(file);
      const backupFile = zipData.file('backup.json');
      
      if (!backupFile) {
        return { valid: false, reason: 'Invalid backup file format' };
      }

      const backupJson = await backupFile.async('string');
      const backupData: BackupData = JSON.parse(backupJson);

      this.validateBackupData(backupData);
      
      return { valid: true, metadata: backupData.metadata };
    } catch (error) {
      return { valid: false, reason: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Private helper methods

  /**
   * Export all data from unified database
   */
  private static async exportUnifiedData() {
    const vfsData = {
      projects: [] as Project[],
      files: [] as VirtualFile[],
      fileTree: [] as unknown[],
      conversations: [] as any[],
      checkpoints: [] as any[]
    };

    return new Promise<typeof vfsData>((resolve, reject) => {
      const request = indexedDB.open('osw-studio-db', 1);
      
      request.onsuccess = async () => {
        try {
          const db = request.result;
          
          // Export projects
          const projectTx = db.transaction(['projects'], 'readonly');
          const projectStore = projectTx.objectStore('projects');
          const projectsRequest = projectStore.getAll();
          projectsRequest.onsuccess = () => {
            vfsData.projects = projectsRequest.result || [];
          };
          
          // Export files
          const fileTx = db.transaction(['files'], 'readonly');
          const fileStore = fileTx.objectStore('files');
          const filesRequest = fileStore.getAll();
          filesRequest.onsuccess = () => {
            vfsData.files = filesRequest.result || [];
          };
          
          // Export file tree
          const treeTx = db.transaction(['fileTree'], 'readonly');
          const treeStore = treeTx.objectStore('fileTree');
          const treeRequest = treeStore.getAll();
          treeRequest.onsuccess = () => {
            vfsData.fileTree = treeRequest.result || [];
          };

          // Export conversations
          const convTx = db.transaction(['conversations'], 'readonly');
          const convStore = convTx.objectStore('conversations');
          const convRequest = convStore.getAll();
          convRequest.onsuccess = () => {
            vfsData.conversations = convRequest.result || [];
          };

          // Export checkpoints
          const checkTx = db.transaction(['checkpoints'], 'readonly');
          const checkStore = checkTx.objectStore('checkpoints');
          const checkRequest = checkStore.getAll();
          checkRequest.onsuccess = () => {
            vfsData.checkpoints = checkRequest.result || [];
          };

          // Wait for all transactions to complete
          await Promise.all([
            new Promise(res => projectTx.oncomplete = () => res(undefined)),
            new Promise(res => fileTx.oncomplete = () => res(undefined)),
            new Promise(res => treeTx.oncomplete = () => res(undefined)),
            new Promise(res => convTx.oncomplete = () => res(undefined)),
            new Promise(res => checkTx.oncomplete = () => res(undefined))
          ]);

          resolve(vfsData);
        } catch (error) {
          reject(error);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Legacy export functions for importing old DeepStudio backups
   */
  private static async importLegacyConversations(): Promise<any[]> {
    return new Promise((resolve) => {
      const request = indexedDB.open('DeepStudioConversations', 1);

      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['conversations'], 'readonly');
        const store = tx.objectStore('conversations');
        const getRequest = store.getAll();

        getRequest.onsuccess = () => {
          resolve(getRequest.result || []);
        };

        getRequest.onerror = () => resolve([]);
      };

      request.onerror = () => resolve([]);
    });
  }

  private static async importLegacyCheckpoints(): Promise<any[]> {
    return new Promise((resolve) => {
      const request = indexedDB.open('DeepStudioCheckpoints', 1);

      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['checkpoints'], 'readonly');
        const store = tx.objectStore('checkpoints');
        const getRequest = store.getAll();

        getRequest.onsuccess = () => {
          resolve(getRequest.result || []);
        };

        getRequest.onerror = () => resolve([]);
      };

      request.onerror = () => resolve([]);
    });
  }

  private static async importUnifiedData(vfsData: any): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info('[Import] Opening database for import...');

      // Timeout to prevent hanging
      const timeout = setTimeout(() => {
        logger.error('[Import] Database open timeout after 10s');
        reject(new Error('Database open timeout'));
      }, 10000);

      const request = indexedDB.open('osw-studio-db', 1);

      request.onerror = () => {
        clearTimeout(timeout);
        logger.error('[Import] Failed to open database for import', request.error);
        reject(request.error);
      };

      request.onblocked = () => {
        logger.warn('[Import] Database open is blocked - waiting for connections to close');
      };

      // Ensure schema is created if database was deleted
      request.onupgradeneeded = (event) => {
        logger.info('[Import] Creating database schema...');
        const db = (event.target as IDBOpenDBRequest).result;

        // Create all object stores if they don't exist
        if (!db.objectStoreNames.contains('projects')) {
          const projectStore = db.createObjectStore('projects', { keyPath: 'id' });
          projectStore.createIndex('name', 'name', { unique: false });
          projectStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        if (!db.objectStoreNames.contains('files')) {
          const fileStore = db.createObjectStore('files', { keyPath: 'id' });
          fileStore.createIndex('projectId', 'projectId', { unique: false });
          fileStore.createIndex('path', ['projectId', 'path'], { unique: true });
          fileStore.createIndex('type', 'type', { unique: false });
        }

        if (!db.objectStoreNames.contains('fileTree')) {
          const treeStore = db.createObjectStore('fileTree', { keyPath: 'id' });
          treeStore.createIndex('projectId', 'projectId', { unique: false });
          treeStore.createIndex('path', ['projectId', 'path'], { unique: true });
          treeStore.createIndex('parentPath', ['projectId', 'parentPath'], { unique: false });
        }

        if (!db.objectStoreNames.contains('conversations')) {
          const conversationStore = db.createObjectStore('conversations', { keyPath: 'id' });
          conversationStore.createIndex('projectId', 'projectId', { unique: false });
          conversationStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
        }

        if (!db.objectStoreNames.contains('checkpoints')) {
          const checkpointStore = db.createObjectStore('checkpoints', { keyPath: 'id' });
          checkpointStore.createIndex('projectId', 'projectId', { unique: false });
          checkpointStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = async () => {
        try {
          clearTimeout(timeout);
          const db = request.result;

          logger.info('[Import] Database opened successfully');
          logger.info('[Import] Starting data import...', {
            projects: vfsData.projects?.length || 0,
            files: vfsData.files?.length || 0,
            fileTree: vfsData.fileTree?.length || 0,
            conversations: vfsData.conversations?.length || 0,
            checkpoints: vfsData.checkpoints?.length || 0
          });

          // Import projects
          const projectTx = db.transaction(['projects'], 'readwrite');
          const projectStore = projectTx.objectStore('projects');
          for (const project of vfsData.projects || []) {
            await new Promise<void>((res, rej) => {
              const req = projectStore.put(project);
              req.onsuccess = () => res();
              req.onerror = () => {
                logger.error('[Import] Failed to import project:', project.id, req.error);
                rej(req.error);
              };
            });
          }
          logger.info('[Import] Projects imported');
          
          // Import files
          const fileTx = db.transaction(['files'], 'readwrite');
          const fileStore = fileTx.objectStore('files');
          for (const file of vfsData.files || []) {
            await new Promise<void>((res, rej) => {
              const req = fileStore.put(file);
              req.onsuccess = () => res();
              req.onerror = () => {
                logger.error('[Import] Failed to import file:', file.path, req.error);
                rej(req.error);
              };
            });
          }
          logger.info('[Import] Files imported');
          
          // Import file tree
          const treeTx = db.transaction(['fileTree'], 'readwrite');
          const treeStore = treeTx.objectStore('fileTree');
          for (const node of vfsData.fileTree || []) {
            await new Promise<void>((res, rej) => {
              const req = treeStore.put(node);
              req.onsuccess = () => res();
              req.onerror = () => {
                logger.error('[Import] Failed to import tree node:', node.path, req.error);
                rej(req.error);
              };
            });
          }
          logger.info('[Import] File tree imported');

          // Import conversations (from vfsData or legacy backup format)
          const conversations = vfsData.conversations || [];
          if (conversations.length > 0) {
            logger.info('[Import] Importing conversations:', conversations.length);
            const convTx = db.transaction(['conversations'], 'readwrite');
            const convStore = convTx.objectStore('conversations');
            for (const conversation of conversations) {
              await new Promise<void>((res, rej) => {
                const req = convStore.put(conversation);
                req.onsuccess = () => res();
                req.onerror = () => {
                  logger.error('[Import] Failed to import conversation:', conversation.id, req.error);
                  rej(req.error);
                };
              });
            }
            logger.info('[Import] Conversations imported');
          }

          // Import checkpoints (from vfsData or legacy backup format)
          const checkpoints = vfsData.checkpoints || [];
          if (checkpoints.length > 0) {
            logger.info('[Import] Importing checkpoints:', checkpoints.length);
            const checkTx = db.transaction(['checkpoints'], 'readwrite');
            const checkStore = checkTx.objectStore('checkpoints');
            for (const checkpoint of checkpoints) {
              await new Promise<void>((res, rej) => {
                const req = checkStore.put(checkpoint);
                req.onsuccess = () => res();
                req.onerror = () => {
                  logger.error('[Import] Failed to import checkpoint:', checkpoint.id, req.error);
                  rej(req.error);
                };
              });
            }
            logger.info('[Import] Checkpoints imported');
          }

          logger.info('[Import] All data imported successfully');
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }


  private static async clearAllData(): Promise<void> {
    const allDbs = [
      'osw-studio-db',
      'osw-studio-vfs',
      'OSWStudioConversations',
      'OSWStudioCheckpoints',
      'deepstudio-vfs',
      'DeepStudioConversations',
      'DeepStudioCheckpoints'
    ];

    for (const dbName of allDbs) {
      await new Promise<void>((resolve) => {
        // Set a timeout to prevent hanging
        const timeout = setTimeout(() => {
          logger.warn(`[Backup] Database deletion timeout for: ${dbName}`);
          resolve();
        }, 2000);

        const deleteRequest = indexedDB.deleteDatabase(dbName);

        deleteRequest.onsuccess = () => {
          clearTimeout(timeout);
          logger.info(`[Backup] Deleted database: ${dbName}`);
          resolve();
        };

        deleteRequest.onerror = () => {
          clearTimeout(timeout);
          logger.warn(`[Backup] Error deleting database: ${dbName}`, deleteRequest.error);
          resolve(); // Continue anyway
        };

        deleteRequest.onblocked = () => {
          logger.warn(`[Backup] Database deletion blocked: ${dbName}`);
          // Don't resolve yet, wait for unblock or timeout
        };
      });
    }

    logger.info('[Backup] All databases cleared');
  }

  private static validateBackupData(data: BackupData): void {
    if (!data.version || !data.exportDate || !data.databases || !data.metadata) {
      throw new Error('Invalid backup file structure');
    }

    if (!data.databases.vfs || !data.databases.conversations || !data.databases.checkpoints) {
      throw new Error('Incomplete backup data');
    }

    // Version compatibility check (for future versions)
    const backupVersion = data.version.split('.').map(Number);
    const currentVersion = this.BACKUP_VERSION.split('.').map(Number);
    
    if (backupVersion[0] > currentVersion[0]) {
      throw new Error(`Backup version ${data.version} is not compatible with current version ${this.BACKUP_VERSION}`);
    }
  }

  private static calculateDataSize(data: BackupData): number {
    return JSON.stringify(data).length;
  }

  private static formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private static downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
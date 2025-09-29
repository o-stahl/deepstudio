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
          vfs: await this.exportVFSData(),
          conversations: await this.exportConversationData(),
          checkpoints: await this.exportCheckpointData(),
        },
        metadata: {
          projectCount: 0,
          totalSize: 0,
          exportedFrom: 'deepstudio',
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
        await this.clearAllData();
      }

      // Import data
      options.onProgress?.(50, 'Importing projects and files...');
      await this.importVFSData(backupData.databases.vfs);

      options.onProgress?.(70, 'Importing conversations...');
      await this.importConversationData(backupData.databases.conversations);

      options.onProgress?.(90, 'Importing checkpoints...');
      await this.importCheckpointData(backupData.databases.checkpoints);

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
  private static async exportVFSData() {
    const vfsData = { projects: [] as Project[], files: [] as VirtualFile[], fileTree: [] as unknown[] };
    
    return new Promise<typeof vfsData>((resolve, reject) => {
      const request = indexedDB.open('deepstudio-vfs', 1);
      
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
          
          // Wait for all transactions to complete
          await Promise.all([
            new Promise(res => projectTx.oncomplete = () => res(undefined)),
            new Promise(res => fileTx.oncomplete = () => res(undefined)),
            new Promise(res => treeTx.oncomplete = () => res(undefined))
          ]);
          
          resolve(vfsData);
        } catch (error) {
          reject(error);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  private static async exportConversationData(): Promise<ConversationState[]> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('DeepStudioConversations', 1);
      
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['conversations'], 'readonly');
        const store = tx.objectStore('conversations');
        const getRequest = store.getAll();
        
        getRequest.onsuccess = () => {
          resolve(getRequest.result || []);
        };
        
        getRequest.onerror = () => reject(getRequest.error);
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  private static async exportCheckpointData(): Promise<Checkpoint[]> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('DeepStudioCheckpoints', 1);
      
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['checkpoints'], 'readonly');
        const store = tx.objectStore('checkpoints');
        const getRequest = store.getAll();
        
        getRequest.onsuccess = () => {
          resolve(getRequest.result || []);
        };
        
        getRequest.onerror = () => reject(getRequest.error);
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  private static async importVFSData(vfsData: BackupData['databases']['vfs']): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('deepstudio-vfs', 1);
      
      request.onsuccess = async () => {
        try {
          const db = request.result;
          
          // Import projects
          const projectTx = db.transaction(['projects'], 'readwrite');
          const projectStore = projectTx.objectStore('projects');
          for (const project of vfsData.projects) {
            await new Promise<void>((res, rej) => {
              const req = projectStore.put(project);
              req.onsuccess = () => res();
              req.onerror = () => rej(req.error);
            });
          }
          
          // Import files
          const fileTx = db.transaction(['files'], 'readwrite');
          const fileStore = fileTx.objectStore('files');
          for (const file of vfsData.files) {
            await new Promise<void>((res, rej) => {
              const req = fileStore.put(file);
              req.onsuccess = () => res();
              req.onerror = () => rej(req.error);
            });
          }
          
          // Import file tree
          const treeTx = db.transaction(['fileTree'], 'readwrite');
          const treeStore = treeTx.objectStore('fileTree');
          for (const node of vfsData.fileTree) {
            await new Promise<void>((res, rej) => {
              const req = treeStore.put(node);
              req.onsuccess = () => res();
              req.onerror = () => rej(req.error);
            });
          }
          
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  private static async importConversationData(conversations: ConversationState[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('DeepStudioConversations', 1);
      
      request.onsuccess = async () => {
        try {
          const db = request.result;
          const tx = db.transaction(['conversations'], 'readwrite');
          const store = tx.objectStore('conversations');
          
          for (const conversation of conversations) {
            await new Promise<void>((res, rej) => {
              const req = store.put(conversation);
              req.onsuccess = () => res();
              req.onerror = () => rej(req.error);
            });
          }
          
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  private static async importCheckpointData(checkpoints: Checkpoint[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('DeepStudioCheckpoints', 1);
      
      request.onsuccess = async () => {
        try {
          const db = request.result;
          const tx = db.transaction(['checkpoints'], 'readwrite');
          const store = tx.objectStore('checkpoints');
          
          for (const checkpoint of checkpoints) {
            await new Promise<void>((res, rej) => {
              const req = store.put(checkpoint);
              req.onsuccess = () => res();
              req.onerror = () => rej(req.error);
            });
          }
          
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  private static async clearAllData(): Promise<void> {
    const dbNames = ['deepstudio-vfs', 'DeepStudioConversations', 'DeepStudioCheckpoints'];
    
    for (const dbName of dbNames) {
      await new Promise<void>((resolve, reject) => {
        const deleteRequest = indexedDB.deleteDatabase(dbName);
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => reject(deleteRequest.error);
      });
    }
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
import { Project, VirtualFile, FileTreeNode, CustomTemplate } from './types';

const DB_NAME = 'osw-studio-db';
const DB_VERSION = 2;

export class VFSDatabase {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // VFS object stores
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

        // Conversations object store
        if (!db.objectStoreNames.contains('conversations')) {
          const conversationStore = db.createObjectStore('conversations', { keyPath: 'id' });
          conversationStore.createIndex('projectId', 'projectId', { unique: false });
          conversationStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
        }

        // Checkpoints object store
        if (!db.objectStoreNames.contains('checkpoints')) {
          const checkpointStore = db.createObjectStore('checkpoints', { keyPath: 'id' });
          checkpointStore.createIndex('projectId', 'projectId', { unique: false });
          checkpointStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Custom Templates object store
        if (!db.objectStoreNames.contains('customTemplates')) {
          const templateStore = db.createObjectStore('customTemplates', { keyPath: 'id' });
          templateStore.createIndex('name', 'name', { unique: false });
          templateStore.createIndex('importedAt', 'importedAt', { unique: false });
        }
      };
    });
  }

  private getDB(): IDBDatabase {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    return this.db;
  }

  // Public getter for shared database access (used by checkpoint and conversation managers)
  getDatabase(): IDBDatabase {
    return this.getDB();
  }

  async createProject(project: Project): Promise<void> {
    const tx = this.getDB().transaction(['projects'], 'readwrite');
    const store = tx.objectStore('projects');
    await this.promisify(store.add(project));
  }

  async getProject(id: string): Promise<Project | null> {
    const tx = this.getDB().transaction(['projects'], 'readonly');
    const store = tx.objectStore('projects');
    const result = await this.promisify(store.get(id));
    return result ? this.hydrateProject(result as Project) : null;
  }

  async updateProject(project: Project): Promise<void> {
    const tx = this.getDB().transaction(['projects'], 'readwrite');
    const store = tx.objectStore('projects');
    await this.promisify(store.put(project));
  }

  async deleteProject(id: string): Promise<void> {
    const db = this.getDB();
    
    await this.deleteProjectFiles(id);
    
    const tx = db.transaction(['projects'], 'readwrite');
    const store = tx.objectStore('projects');
    await this.promisify(store.delete(id));
  }

  async listProjects(): Promise<Project[]> {
    const tx = this.getDB().transaction(['projects'], 'readonly');
    const store = tx.objectStore('projects');
    const result = await this.promisify(store.getAll());
    return (result as Project[] | undefined)?.map((project) => this.hydrateProject(project)) || [];
  }

  async createFile(file: VirtualFile): Promise<void> {
    const tx = this.getDB().transaction(['files'], 'readwrite');
    const store = tx.objectStore('files');
    await this.promisify(store.add(file));
  }

  async getFile(projectId: string, path: string): Promise<VirtualFile | null> {
    const tx = this.getDB().transaction(['files'], 'readonly');
    const store = tx.objectStore('files');
    const index = store.index('path');
    const result = await this.promisify(index.get([projectId, path]));
    return result || null;
  }

  async updateFile(file: VirtualFile): Promise<void> {
    const tx = this.getDB().transaction(['files'], 'readwrite');
    const store = tx.objectStore('files');
    await this.promisify(store.put(file));
  }

  async deleteFile(projectId: string, path: string): Promise<void> {
    const file = await this.getFile(projectId, path);
    if (file) {
      const tx = this.getDB().transaction(['files'], 'readwrite');
      const store = tx.objectStore('files');
      await this.promisify(store.delete(file.id));
    }
  }

  async listFiles(projectId: string): Promise<VirtualFile[]> {
    const tx = this.getDB().transaction(['files'], 'readonly');
    const store = tx.objectStore('files');
    const index = store.index('projectId');
    const result = await this.promisify(index.getAll(projectId));
    return result || [];
  }

  async deleteProjectFiles(projectId: string): Promise<void> {
    const files = await this.listFiles(projectId);
    const tx = this.getDB().transaction(['files'], 'readwrite');
    const store = tx.objectStore('files');
    
    for (const file of files) {
      await this.promisify(store.delete(file.id));
    }
  }

  async createTreeNode(node: FileTreeNode): Promise<void> {
    const tx = this.getDB().transaction(['fileTree'], 'readwrite');
    const store = tx.objectStore('fileTree');
    await this.promisify(store.add(node));
  }

  async getTreeNode(projectId: string, path: string): Promise<FileTreeNode | null> {
    const tx = this.getDB().transaction(['fileTree'], 'readonly');
    const store = tx.objectStore('fileTree');
    const index = store.index('path');
    const result = await this.promisify(index.get([projectId, path]));
    return result || null;
  }

  async updateTreeNode(node: FileTreeNode): Promise<void> {
    const tx = this.getDB().transaction(['fileTree'], 'readwrite');
    const store = tx.objectStore('fileTree');
    await this.promisify(store.put(node));
  }

  async deleteTreeNode(projectId: string, path: string): Promise<void> {
    const node = await this.getTreeNode(projectId, path);
    if (node) {
      const tx = this.getDB().transaction(['fileTree'], 'readwrite');
      const store = tx.objectStore('fileTree');
      await this.promisify(store.delete(node.id));
    }
  }

  async getChildNodes(projectId: string, parentPath: string | null): Promise<FileTreeNode[]> {
    const tx = this.getDB().transaction(['fileTree'], 'readonly');
    const store = tx.objectStore('fileTree');
    const index = store.index('parentPath');
    const key = parentPath === null ? [projectId] : [projectId, parentPath];
    const result = await this.promisify(index.getAll(key));
    return result || [];
  }

  async getAllTreeNodes(projectId: string): Promise<FileTreeNode[]> {
    const tx = this.getDB().transaction(['fileTree'], 'readonly');
    const store = tx.objectStore('fileTree');
    const index = store.index('projectId');
    const result = await this.promisify(index.getAll(projectId));
    return result || [];
  }

  private promisify<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private hydrateProject(project: Project): Project {
    return {
      ...project,
      createdAt: project.createdAt ? new Date(project.createdAt) : new Date(),
      updatedAt: project.updatedAt ? new Date(project.updatedAt) : new Date(),
      lastSavedAt: project.lastSavedAt ? new Date(project.lastSavedAt) : null
    };
  }

  // Custom Templates CRUD operations
  async saveCustomTemplate(template: CustomTemplate): Promise<void> {
    const tx = this.getDB().transaction(['customTemplates'], 'readwrite');
    const store = tx.objectStore('customTemplates');
    await this.promisify(store.put(template));
  }

  async getCustomTemplate(id: string): Promise<CustomTemplate | null> {
    const tx = this.getDB().transaction(['customTemplates'], 'readonly');
    const store = tx.objectStore('customTemplates');
    const result = await this.promisify(store.get(id));
    return result ? this.hydrateCustomTemplate(result as CustomTemplate) : null;
  }

  async getAllCustomTemplates(): Promise<CustomTemplate[]> {
    const tx = this.getDB().transaction(['customTemplates'], 'readonly');
    const store = tx.objectStore('customTemplates');
    const results = await this.promisify(store.getAll());
    return results.map(t => this.hydrateCustomTemplate(t as CustomTemplate));
  }

  async deleteCustomTemplate(id: string): Promise<void> {
    const tx = this.getDB().transaction(['customTemplates'], 'readwrite');
    const store = tx.objectStore('customTemplates');
    await this.promisify(store.delete(id));
  }

  private hydrateCustomTemplate(template: CustomTemplate): CustomTemplate {
    return {
      ...template,
      importedAt: template.importedAt ? new Date(template.importedAt) : new Date()
    };
  }
}

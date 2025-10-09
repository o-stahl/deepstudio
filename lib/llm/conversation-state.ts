/**
 * Conversation State Management
 * Handles conversation persistence and state management with IndexedDB
 */

import { logger } from '@/lib/utils';
import { OrchestratorMessage } from './orchestrator';

export interface ConversationState {
  id: string;
  projectId: string;
  messages: OrchestratorMessage[];
  lastUpdated: string;
  version: number;
}

export interface ConversationBreak {
  type: 'checkpoint_restore' | 'retry' | 'clear' | 'page_refresh' | 'manual_save';
  timestamp: string;
  checkpointId?: string;
  description?: string;
}

// Serializable format for storage
interface StoredConversationState {
  id: string;
  projectId: string;
  messages: OrchestratorMessage[];
  lastUpdated: string;
  version: number;
  breaks: ConversationBreak[];
}

export class ConversationStateManager {
  private conversations: Map<string, ConversationState> = new Map();
  private conversationBreaks: Map<string, ConversationBreak[]> = new Map();
  private storeName = 'conversations';
  private isInitialized = false;

  /**
   * Initialize by ensuring VFS database is ready
   */
  private async initDB(): Promise<void> {
    if (this.isInitialized) return;

    // Import vfs dynamically to avoid circular dependency
    const { vfs } = await import('@/lib/vfs');
    await vfs.init();
    this.isInitialized = true;
  }

  /**
   * Get shared database connection from VFS
   */
  private async getDB(): Promise<IDBDatabase> {
    const { vfs } = await import('@/lib/vfs');
    return (vfs as any).db.getDatabase();
  }

  /**
   * Get conversation ID for a project
   */
  private getConversationId(projectId: string): string {
    return `conv_${projectId}`;
  }

  /**
   * Load conversation from IndexedDB
   */
  private async loadConversationFromDB(projectId: string): Promise<ConversationState | null> {
    await this.initDB();
    const db = await this.getDB();

    const conversationId = this.getConversationId(projectId);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(conversationId);

      request.onsuccess = () => {
        const stored = request.result as StoredConversationState;
        if (stored) {
          const conversation: ConversationState = {
            id: stored.id,
            projectId: stored.projectId,
            messages: stored.messages || [],
            lastUpdated: stored.lastUpdated,
            version: stored.version || 1
          };

          // Load conversation breaks
          this.conversationBreaks.set(projectId, stored.breaks || []);

          resolve(conversation);
        } else {
          resolve(null);
        }
      };

      request.onerror = () => {
        logger.error('Failed to load conversation from DB');
        reject(request.error);
      };
    });
  }

  /**
   * Save conversation to IndexedDB
   */
  private async saveConversationToDB(conversation: ConversationState): Promise<void> {
    await this.initDB();
    const db = await this.getDB();

    const breaks = this.conversationBreaks.get(conversation.projectId) || [];

    const storedConversation: StoredConversationState = {
      id: conversation.id,
      projectId: conversation.projectId,
      messages: conversation.messages,
      lastUpdated: conversation.lastUpdated,
      version: conversation.version,
      breaks
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(storedConversation);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        logger.error('Failed to save conversation to DB');
        reject(request.error);
      };
    });
  }

  /**
   * Delete conversation from IndexedDB
   */
  private async deleteConversationFromDB(projectId: string): Promise<void> {
    await this.initDB();
    const db = await this.getDB();

    const conversationId = this.getConversationId(projectId);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(conversationId);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        logger.error('Failed to delete conversation from DB');
        reject(request.error);
      };
    });
  }

  /**
   * Get conversation for a project
   */
  async getConversation(projectId: string): Promise<ConversationState> {
    let conversation = this.conversations.get(projectId);
    
    if (!conversation) {
      // Try to load from IndexedDB
      const loaded = await this.loadConversationFromDB(projectId);
      
      if (loaded) {
        conversation = loaded;
      } else {
        // Create new conversation
        conversation = {
          id: this.getConversationId(projectId),
          projectId,
          messages: [],
          lastUpdated: new Date().toISOString(),
          version: 1
        };
      }
      
      this.conversations.set(projectId, conversation);
    }

    return conversation;
  }

  /**
   * Update conversation with new messages
   */
  async updateConversation(projectId: string, messages: OrchestratorMessage[]): Promise<void> {
    const conversation = await this.getConversation(projectId);
    
    conversation.messages = [...messages];
    conversation.lastUpdated = new Date().toISOString();
    conversation.version += 1;
    
    this.conversations.set(projectId, conversation);
    await this.saveConversationToDB(conversation);
    
    logger.debug(`[ConversationState] Updated conversation for project ${projectId} with ${messages.length} messages`);
  }

  /**
   * Clear conversation for a project
   */
  async clearConversation(projectId: string): Promise<void> {
    const conversation = await this.getConversation(projectId);
    
    // Record the clear action as a break
    await this.recordConversationBreak(projectId, {
      type: 'clear',
      timestamp: new Date().toISOString(),
      description: 'User cleared chat'
    });

    conversation.messages = [];
    conversation.lastUpdated = new Date().toISOString();
    conversation.version += 1;
    
    this.conversations.set(projectId, conversation);
    await this.saveConversationToDB(conversation);
    
    logger.debug(`[ConversationState] Cleared conversation for project ${projectId}`);
  }

  /**
   * Record a conversation break (checkpoint restore, retry, etc.)
   */
  async recordConversationBreak(projectId: string, breakInfo: ConversationBreak): Promise<void> {
    let breaks = this.conversationBreaks.get(projectId) || [];
    breaks.push(breakInfo);
    
    // Keep only the last 20 breaks
    if (breaks.length > 20) {
      breaks = breaks.slice(-20);
    }
    
    this.conversationBreaks.set(projectId, breaks);
    
    // Save to DB if conversation exists
    const conversation = this.conversations.get(projectId);
    if (conversation) {
      await this.saveConversationToDB(conversation);
    }
    
    logger.debug(`[ConversationState] Recorded conversation break for project ${projectId}:`, breakInfo.type);
  }

  /**
   * Get recent conversation breaks for context
   */
  getRecentBreaks(projectId: string, limit: number = 5): ConversationBreak[] {
    const breaks = this.conversationBreaks.get(projectId) || [];
    return breaks.slice(-limit);
  }

  /**
   * Add context message about a break
   */
  async addBreakContextMessage(projectId: string, breakInfo: ConversationBreak): Promise<void> {
    const conversation = await this.getConversation(projectId);
    
    let contextMessage: string;
    switch (breakInfo.type) {
      case 'checkpoint_restore':
        contextMessage = `[Context: Project was restored to checkpoint "${breakInfo.description || 'previous state'}" at ${new Date(breakInfo.timestamp).toLocaleTimeString()}]`;
        break;
      case 'retry':
        contextMessage = `[Context: Retrying previous request after restoring to checkpoint at ${new Date(breakInfo.timestamp).toLocaleTimeString()}]`;
        break;
      case 'page_refresh':
        contextMessage = `[Context: Session resumed after page refresh at ${new Date(breakInfo.timestamp).toLocaleTimeString()}]`;
        break;
      case 'manual_save':
        contextMessage = `[Context: Project saved manually at ${new Date(breakInfo.timestamp).toLocaleTimeString()}${breakInfo.description ? ` (${breakInfo.description})` : ''}]`;
        break;
      default:
        return; // Don't add context for clear actions
    }

    const contextOrchestratorMessage: OrchestratorMessage = {
      role: 'system',
      content: contextMessage
    };

    conversation.messages.push(contextOrchestratorMessage);
    await this.updateConversation(projectId, conversation.messages);
  }

  /**
   * Get conversation messages with smart truncation
   */
  async getConversationMessages(projectId: string, maxMessages?: number): Promise<OrchestratorMessage[]> {
    const conversation = await this.getConversation(projectId);
    
    if (!maxMessages || conversation.messages.length <= maxMessages) {
      return [...conversation.messages];
    }

    // Smart truncation: keep system messages, recent user/assistant exchanges
    const messages = [...conversation.messages];
    const systemMessages = messages.filter(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');
    
    // Keep recent messages
    const recentMessages = nonSystemMessages.slice(-(maxMessages - systemMessages.length));
    
    // Combine system messages at start + recent conversation
    return [...systemMessages, ...recentMessages];
  }

  /**
   * Delete all data for a project
   */
  async deleteProject(projectId: string): Promise<void> {
    this.conversations.delete(projectId);
    this.conversationBreaks.delete(projectId);
    await this.deleteConversationFromDB(projectId);
    
    logger.debug(`[ConversationState] Deleted all conversation data for project ${projectId}`);
  }

  /**
   * Get conversation statistics
   */
  async getConversationStats(projectId: string): Promise<{
    messageCount: number;
    lastUpdated: string;
    breaks: number;
    version: number;
  }> {
    const conversation = await this.getConversation(projectId);
    const breaks = this.conversationBreaks.get(projectId) || [];
    
    return {
      messageCount: conversation.messages.length,
      lastUpdated: conversation.lastUpdated,
      breaks: breaks.length,
      version: conversation.version
    };
  }
}

export const conversationState = new ConversationStateManager();

/**
 * Simplified Conversation Format Converter
 * Converts between UI Message format and Orchestrator Message format
 */

import { logger } from '@/lib/utils';
import { OrchestratorMessage } from './orchestrator';

// UI Message type (from workspace)
export interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  checkpointId?: string;
  isTask?: boolean;
  [key: string]: any; // Allow additional properties
}

// Tool message item structure used in UI
interface ToolMessageItem {
  id: string;
  type: 'message' | 'tool' | 'divider';
  content?: string;
  name?: string;
  parameters?: any;
  result?: any;
  status?: 'pending' | 'executing' | 'completed' | 'failed';
  title?: string;
  subtitle?: string;
}

export class ConversationConverter {
  
  /**
   * Convert UI messages to Orchestrator messages (preserving tool calls)
   */
  static convertToOrchestratorMessages(uiMessages: UIMessage[]): OrchestratorMessage[] {
    const orchestratorMessages: OrchestratorMessage[] = [];

    for (const uiMessage of uiMessages) {
      // Skip task progress messages - these are UI-only
      if (uiMessage.isTask) {
        continue;
      }

      // Convert user and assistant messages
      if (uiMessage.role === 'user') {
        orchestratorMessages.push({
          role: 'user',
          content: uiMessage.content || ''
        });
      } else if (uiMessage.role === 'assistant') {
        const assistantMsg: OrchestratorMessage = {
          role: 'assistant',
          content: uiMessage.content || ''
        };
        
        // Preserve tool calls if present
        if (uiMessage.toolCalls && uiMessage.toolCalls.length > 0) {
          assistantMsg.tool_calls = uiMessage.toolCalls;
        }
        
        // If we have toolMessages, convert them to tool_calls format and extract thinking content
        if (uiMessage.toolMessages && !assistantMsg.tool_calls) {
          const toolCalls = [];
          const toolMessages = uiMessage.toolMessages as ToolMessageItem[];
          
          for (const tm of toolMessages) {
            if (tm.type === 'tool' && tm.name) {
              toolCalls.push({
                id: tm.id || `tool_${toolCalls.length}`,
                type: 'function',
                function: {
                  name: tm.name,
                  arguments: JSON.stringify(tm.parameters || {})
                }
              });
            }
          }
          
          if (toolCalls.length > 0) {
            assistantMsg.tool_calls = toolCalls as any;
          }
        }
        
        // Store UI metadata for complete session recovery
        const hasMetadata = uiMessage.checkpointId || uiMessage.cost || uiMessage.usage || uiMessage.toolMessages;
        if (hasMetadata) {
          assistantMsg.ui_metadata = {};
          
          if (uiMessage.checkpointId) {
            assistantMsg.ui_metadata.checkpointId = uiMessage.checkpointId;
          }
          
          if (uiMessage.cost) {
            assistantMsg.ui_metadata.cost = uiMessage.cost;
          }
          
          if (uiMessage.usage) {
            assistantMsg.ui_metadata.usage = uiMessage.usage;
          }
          
          // Store complete toolMessages array for full reconstruction
          if (uiMessage.toolMessages) {
            assistantMsg.ui_metadata.toolMessages = uiMessage.toolMessages;
          }
        }
        
        // Extract and combine thinking content from toolMessages with main content
        if (uiMessage.toolMessages) {
          const toolMessages = uiMessage.toolMessages as ToolMessageItem[];
          const thinkingContent: string[] = [];
          
          // Collect all thinking content (type: 'message') 
          for (const tm of toolMessages) {
            if (tm.type === 'message' && tm.content) {
              thinkingContent.push(tm.content);
            }
          }
          
          // Combine thinking content with main content
          if (thinkingContent.length > 0) {
            const combinedContent = [assistantMsg.content, ...thinkingContent].filter(c => c && c.trim()).join('\n\n');
            assistantMsg.content = combinedContent;
          }
        }
        
        orchestratorMessages.push(assistantMsg);
        
        // Add tool result messages if they exist
        if (uiMessage.toolMessages) {
          const toolMessages = uiMessage.toolMessages as ToolMessageItem[];
          for (let i = 0; i < toolMessages.length; i++) {
            const tm = toolMessages[i];
            if (tm.type === 'tool' && tm.result !== undefined && tm.result !== null) {
              // Find the corresponding tool call ID
              const toolCallId = tm.id || `tool_${i}`;
              orchestratorMessages.push({
                role: 'tool',
                tool_call_id: toolCallId,
                content: typeof tm.result === 'string' ? tm.result : JSON.stringify(tm.result)
              });
            }
          }
        }
      }
    }

    return orchestratorMessages;
  }

  /**
   * Convert Orchestrator messages back to UI format (with complete reconstruction)
   */
  static convertToUIMessages(orchestratorMessages: OrchestratorMessage[]): Partial<UIMessage>[] {
    const uiMessages: Partial<UIMessage>[] = [];
    let messageIdCounter = 0;
    
    // Create stable IDs based on message index
    const createStableId = (prefix: string) => {
      return `${prefix}_recovered_${messageIdCounter++}`;
    };
    
    for (let i = 0; i < orchestratorMessages.length; i++) {
      const message = orchestratorMessages[i];
      
      // Skip system messages for UI display
      if (message.role === 'system') {
        continue;
      }
      
      // Skip tool result messages - we'll process them with their assistant message
      if (message.role === 'tool') {
        continue;
      }
      
      if (message.role === 'user') {
        uiMessages.push({
          id: createStableId('user'),
          role: 'user',
          content: message.content
        });
      } else if (message.role === 'assistant') {
        const assistantMessage: Partial<UIMessage> = {
          id: createStableId('assistant'),
          role: 'assistant',
          content: message.content || ''
        };
        
        // Restore metadata from ui_metadata if present
        if (message.ui_metadata) {
          if (message.ui_metadata.checkpointId) {
            assistantMessage.checkpointId = message.ui_metadata.checkpointId;
          }
          
          if (message.ui_metadata.cost) {
            assistantMessage.cost = message.ui_metadata.cost;
          }
          
          if (message.ui_metadata.usage) {
            assistantMessage.usage = message.ui_metadata.usage;
          }
          
          // If we have stored toolMessages, use them directly for perfect reconstruction
          if (message.ui_metadata.toolMessages) {
            assistantMessage.toolMessages = message.ui_metadata.toolMessages;
            
            // Also set toolCalls from the stored toolMessages for compatibility
            const toolCalls = [];
            for (const tm of message.ui_metadata.toolMessages) {
              if (tm.type === 'tool' && tm.name) {
                toolCalls.push({
                  id: tm.id,
                  type: 'function' as const,
                  function: {
                    name: tm.name,
                    arguments: JSON.stringify(tm.parameters || {})
                  }
                });
              }
            }
            if (toolCalls.length > 0) {
              assistantMessage.toolCalls = toolCalls;
            }
          }
        }
        
        // Fallback: If no stored toolMessages but we have tool_calls, reconstruct manually
        if (!assistantMessage.toolMessages && message.tool_calls && message.tool_calls.length > 0) {
          const toolMessages: ToolMessageItem[] = [];
          
          // Add any leading text content as a message item
          if (message.content && message.content.trim()) {
            toolMessages.push({
              id: createStableId('msg'),
              type: 'message',
              content: message.content
            });
          }
          
          // Process each tool call
          for (const toolCall of message.tool_calls) {
            const tc = toolCall as any; // Type assertion to handle OpenAI-style tool calls
            const toolId = tc.id || createStableId('tool');
            
            // Parse arguments safely
            let parameters = {};
            if (tc.function?.arguments) {
              try {
                parameters = JSON.parse(tc.function.arguments);
              } catch {
                // If parsing fails, store as-is
                parameters = { arguments: tc.function.arguments };
              }
            }
            
            // Find the corresponding tool result message
            let toolResult = null;
            for (let j = i + 1; j < orchestratorMessages.length; j++) {
              const nextMsg = orchestratorMessages[j];
              if (nextMsg.role === 'tool' && nextMsg.tool_call_id === tc.id) {
                toolResult = nextMsg.content;
                break;
              }
              // Stop if we hit another user or assistant message
              if (nextMsg.role === 'user' || nextMsg.role === 'assistant') {
                break;
              }
            }
            
            // Add the tool call to toolMessages
            toolMessages.push({
              id: toolId,
              type: 'tool',
              name: tc.function?.name || tc.type || 'unknown',
              parameters: parameters,
              result: toolResult,
              status: 'completed' // Mark as completed since these are historical
            });
          }
          
          // Only add toolMessages if we have any
          if (toolMessages.length > 0) {
            assistantMessage.toolMessages = toolMessages;
          }
          
          // Also preserve the original tool_calls for compatibility
          assistantMessage.toolCalls = message.tool_calls;
        }
        
        uiMessages.push(assistantMessage);
      }
    }
    
    logger.debug(`[ConversationConverter] Converted ${orchestratorMessages.length} orchestrator messages to ${uiMessages.length} UI messages`);
    
    return uiMessages;
  }

  /**
   * Truncate conversation to reasonable length while preserving context
   */
  static truncateConversation(
    messages: OrchestratorMessage[], 
    maxMessages: number = 50
  ): OrchestratorMessage[] {
    if (messages.length <= maxMessages) {
      return messages;
    }

    // Always keep system messages
    const systemMessages = messages.filter(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');
    
    // Calculate how many non-system messages we can keep
    const remainingSlots = maxMessages - systemMessages.length;
    
    if (remainingSlots <= 0) {
      return systemMessages;
    }
    
    // Keep the most recent non-system messages
    const recentMessages = otherMessages.slice(-remainingSlots);
    
    // Combine system messages at the start with recent messages
    return [...systemMessages, ...recentMessages];
  }

  /**
   * Add context message about conversation state
   */
  static createContextMessage(type: string, description: string): OrchestratorMessage {
    return {
      role: 'system',
      content: `[Context: ${description}]`
    };
  }

  /**
   * Clean and prepare conversation for orchestrator
   */
  static prepareConversationForOrchestrator(
    uiMessages: UIMessage[],
    options: {
      maxMessages?: number;
      includeSystemPrompt?: boolean;
      systemPrompt?: string;
    } = {}
  ): OrchestratorMessage[] {
    // Convert UI messages to orchestrator format
    let orchestratorMessages = this.convertToOrchestratorMessages(uiMessages);
    
    // Add system prompt if requested and not already present
    if (options.includeSystemPrompt && options.systemPrompt) {
      const hasSystemMessage = orchestratorMessages.some(m => m.role === 'system');
      if (!hasSystemMessage) {
        orchestratorMessages.unshift({
          role: 'system',
          content: options.systemPrompt
        });
      }
    }
    
    // Truncate if necessary
    if (options.maxMessages) {
      orchestratorMessages = this.truncateConversation(orchestratorMessages, options.maxMessages);
    }
    
    logger.debug(`[ConversationConverter] Prepared ${orchestratorMessages.length} messages for orchestrator`);
    
    return orchestratorMessages;
  }
}

// Export is above in the class declaration
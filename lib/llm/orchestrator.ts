/**
 * Orchestrator - Handles AI task execution with tool support
 * Manages LLM communication, tool execution, checkpointing, and cost tracking
 */

import { vfs, VirtualFileSystem, VirtualFile } from '@/lib/vfs';
import { checkpointManager, Checkpoint } from '@/lib/vfs/checkpoint';
import { saveManager } from '@/lib/vfs/save-manager';
import { configManager } from '@/lib/config/storage';
import { getProvider } from '@/lib/llm/providers/registry';
import { CostCalculator } from './cost-calculator';
import { ToolDefinition, UsageInfo, ToolCall } from './types';
import { GenerationAPIService, GenerationUsage } from './generation-api';
import { SHELL_TOOL_DEF, JSON_PATCH_TOOL_DEF } from './shell-tool';
import { EVALUATION_TOOL_DEF } from './evaluation-tool';
import { buildShellSystemPrompt } from './system-prompt';
import { vfsShell } from '@/lib/vfs/cli-shell';
import { execStringPatch } from './string-patch';
import { logger } from '@/lib/utils';
import { toast } from 'sonner';
import { registerOpenRouterPricingFromApi, registerPricingFromProviderModels } from './pricing-cache';
import { fetchAvailableModels } from './models-api';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Parse a shell command string into an array of arguments
 * Handles quoted arguments and basic shell escaping
 */
function parseShellCommand(cmdStr: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';
  let escaped = false;

  for (let i = 0; i < cmdStr.length; i++) {
    const char = cmdStr[i];
    
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    
    if (char === '\\') {
      escaped = true;
      continue;
    }
    
    if (inQuotes) {
      if (char === quoteChar) {
        inQuotes = false;
        quoteChar = '';
      } else {
        current += char;
      }
    } else {
      if (char === '"' || char === "'") {
        inQuotes = true;
        quoteChar = char;
      } else if (char === ' ' || char === '\t') {
        if (current.length > 0) {
          args.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }
  }
  
  if (current.length > 0) {
    args.push(current);
  }
  
  return args;
}

export interface OrchestratorMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  // UI metadata for session recovery
  ui_metadata?: {
    checkpointId?: string;
    cost?: number;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      provider?: string;
      model?: string;
    };
    toolMessages?: any[]; // Store complete toolMessages array for reconstruction
  };
}

export interface StreamResponse {
  content?: string;
  toolCalls?: ToolCall[];
  usage?: UsageInfo;
}

export interface OrchestratorResult {
  success: boolean;
  summary: string;
  stepsCompleted?: number;
  checkpointId?: string;
  conversation: OrchestratorMessage[];
  totalCost?: number;
  usageInfo?: UsageInfo;
}

export class Orchestrator {
  private projectId: string;
  private onProgress?: (message: string, step?: unknown) => void;
  private totalCost = 0;
  private totalUsage: UsageInfo = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0
  };

  private conversation: OrchestratorMessage[] = [];
  private stepsCompleted = 0;
  private taskComplete = false;
  private maxIterations = 100;
  private stopped = false;
  private accumulatedToolCalls: ToolCall[] = [];
  private evaluationResult: {
    goalAchieved: boolean;
    reasoning: string;
    progressSummary?: string;
    remainingWork?: string[];
    blockers?: string[];
    shouldContinue?: boolean;
  } | null = null;
  private malformedToolCallRetries = 0;
  private noToolCallRetries = 0;
  private evaluationRequested = false;
  private evaluationReceived = false;
  private lastIterationHadWrite = false;
  private lastCheckpointId: string | null = null;
  private recentCatReads = new Map<string, number>();
  private pricingEnsured = new Set<string>();
  private chatMode: boolean;
  private model?: string;
  private globalToolIndex = 0;
  private lastToolCallSignature: string | null = null;

  constructor(
    projectId: string,
    existingConversation?: OrchestratorMessage[],
    onProgress?: (message: string, step?: unknown) => void,
    options?: { chatMode?: boolean; model?: string }
  ) {
    this.projectId = projectId;
    this.onProgress = onProgress;
    this.conversation = existingConversation || [];
    this.chatMode = options?.chatMode ?? false;
    this.model = options?.model;
  }

  /**
   * Stop the current generation process
   */
  stop(): void {
    this.stopped = true;
    logger.info('[Orchestrator] Generation stopped by user');
  }
  
  /**
   * Retry logic for HTTP requests with exponential backoff
   */
  private async fetchWithRetry(
    url: string, 
    options: RequestInit, 
    maxRetries: number = 3,
    onRetry?: (attempt: number, delay: number) => void
  ): Promise<Response> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await fetch(url, options);
      
      if (response.status !== 429) {
        return response;
      }
      
      if (attempt === maxRetries) {
        return response;
      }
      
      const retryAfter = response.headers.get('Retry-After');
      const delay = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, attempt) * 1000;
      
      onRetry?.(attempt + 1, delay);
      await sleep(delay);
    }
    
    throw new Error('Unexpected end of retry loop');
  }
  
  /**
   * Get provider configuration
   */
  private getProviderConfig() {
    const provider = configManager.getSelectedProvider();
    const providerConfig = getProvider(provider);
    const apiKey = configManager.getProviderApiKey(provider);
    // Use this.model if set (for chat/code mode separation), otherwise fall back to default
    const model = this.model || configManager.getProviderModel(provider) || undefined;

    // Only require API key for providers that need it
    if (providerConfig.apiKeyRequired && !apiKey) {
      throw new Error(`API key not configured for provider: ${provider}`);
    }

    return {
      provider,
      providerConfig,
      apiKey: apiKey || '',
      model: model || 'default-model'
    };
  }
  
  /**
   * Handle retry notifications
   */
  private handleRetry(attempt: number, delay: number) {
    const message = `Rate limited. Retry attempt ${attempt} in ${delay/1000}s...`;
    logger.warn(message);
    toast.info(message, {
      duration: delay > 2000 ? delay - 500 : 2000,
      description: 'Waiting for rate limit to reset'
    });
  }
  
  /**
   * Stream LLM response with tool support
   */
  private async streamLLMResponse(
    messages: OrchestratorMessage[],
    tools: ToolDefinition[],
    provider: string,
    apiKey: string,
    model: string,
    options?: { suppressAssistantDelta?: boolean; toolChoice?: 'auto' | 'required' | 'any'; maxTokens?: number; enableEarlyToolCallNotification?: boolean }
  ): Promise<StreamResponse> {
    await this.ensurePricing(provider, model);

    const apiUrl = typeof window !== 'undefined'
      ? `${window.location.origin}/api/generate`
      : '/api/generate';

    // Strip ui_metadata from messages before sending to API (providers reject unknown fields)
    const sanitizedMessages = messages.map(msg => {
      const { ui_metadata, ...rest } = msg;
      return rest;
    });

    const requestBody = {
      messages: sanitizedMessages,
      apiKey,
      model,
      provider,
      tools,
      // Only include tool_choice if tools are provided
      ...(tools && tools.length > 0 && { tool_choice: options?.toolChoice || 'auto' }),
      max_tokens: options?.maxTokens
    };
    
    logger.debug(`[Orchestrator] Making API request to ${provider} with ${tools?.length || 0} tools, model: ${model}`, {
      toolChoice: requestBody.tool_choice || 'none'
    });
    
    const response = await this.fetchWithRetry(
      apiUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      },
      3,
      this.handleRetry.bind(this)
    );

    if (!response.ok) {
      let errorMessage = `API call failed: ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData.error) {
          // Extract the detailed error message from API route response
          errorMessage = errorData.error;
        }
      } catch {
        // Failed to parse JSON error response, use statusText
      }
      throw new Error(errorMessage);
    }

    return this.parseStreamingResponse(response, provider, options?.suppressAssistantDelta === true);
  }
  
  /**
   * Parse streaming response from LLM
   */
  private async parseStreamingResponse(response: Response, provider: string, suppressAssistantDelta = false): Promise<StreamResponse> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response stream');
    
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const toolCallsById: Record<string, ToolCall> = {};
    let currentToolCall: Partial<ToolCall> | null = null;
    let toolCallBuffer = '';
    let usageInfo: UsageInfo | undefined;
    
    const DEBUG_TOOL_STREAM = process.env.NEXT_PUBLIC_DEBUG_TOOL_STREAM === '1';
    
    // For Anthropic: track partial JSON building
    const anthropicToolBuffers: Record<string, string> = {};
    const contentBlockIndexToToolId: Record<number, string> = {};
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              if (currentToolCall && toolCallBuffer && currentToolCall.function && currentToolCall.id) {
                currentToolCall.function.arguments = toolCallBuffer;
                toolCallsById[currentToolCall.id] = currentToolCall as ToolCall;
              }
              break;
            }
            
            try {
              const json = JSON.parse(data);
              
              if (provider === 'anthropic') {
                // Handle Anthropic streaming format
                if (json.type === 'content_block_delta' && json.delta?.text_delta?.text) {
                  const piece = json.delta.text_delta.text as string;
                  content += piece;
                  // Stream snapshot of full content (preferred) and the latest piece
                  if (!suppressAssistantDelta) this.onProgress?.('assistant_delta', { text: piece, snapshot: content });
                } else if (json.type === 'content_block_start' && json.content_block?.type === 'tool_use') {
                  const toolCall = {
                    id: json.content_block.id,
                    type: 'function' as const,
                    function: {
                      name: json.content_block.name,
                      arguments: ''
                    }
                  };
                  toolCallsById[json.content_block.id] = toolCall;
                  anthropicToolBuffers[json.content_block.id] = '';
                  contentBlockIndexToToolId[json.index] = json.content_block.id;

                  // Emit early notification for this tool call
                  if (!suppressAssistantDelta) {
                    this.onProgress?.('toolCalls', { toolCalls: [toolCall] });
                  }
                } else if (json.type === 'content_block_delta' && json.delta?.type === 'input_json_delta') {
                  const contentBlockIndex = json.index;
                  const toolId = contentBlockIndexToToolId[contentBlockIndex];

                  if (toolId && json.delta.partial_json) {
                    anthropicToolBuffers[toolId] += json.delta.partial_json;

                    // Update the tool call with partial parameters
                    if (!suppressAssistantDelta && toolCallsById[toolId]) {
                      toolCallsById[toolId].function.arguments = anthropicToolBuffers[toolId];
                      this.onProgress?.('tool_param_delta', {
                        toolId,
                        partialArguments: anthropicToolBuffers[toolId]
                      });
                    }
                  }
                } else if (json.type === 'content_block_stop') {
                  const contentBlockIndex = json.index;
                  const toolId = contentBlockIndexToToolId[contentBlockIndex];
                  
                  if (toolId && anthropicToolBuffers[toolId]) {
                    try {
                      const completeJson = anthropicToolBuffers[toolId];
                      JSON.parse(completeJson); // Validate
                      toolCallsById[toolId].function.arguments = completeJson;
                    } catch (error) {
                      logger.error('Invalid JSON for tool parameters:', anthropicToolBuffers[toolId], error);
                      toolCallsById[toolId].function.arguments = '{}';
                    }
                  }
                }
              } else {
                // Handle OpenAI/OpenRouter streaming format
                const delta = json.choices?.[0]?.delta;
                const finishReason = json.choices?.[0]?.finish_reason;

                // Check for finish_reason to detect completion
                if (finishReason === 'stop' || finishReason === 'tool_calls') {
                  // Stream completed - finalize any pending tool calls
                  if (currentToolCall && toolCallBuffer && currentToolCall.function && currentToolCall.id) {
                    currentToolCall.function.arguments = toolCallBuffer;
                    toolCallsById[currentToolCall.id] = currentToolCall as ToolCall;
                  }
                  break;
                }

                // Check for reasoning field (some models output their thinking here)
                if (delta?.reasoning && !delta?.content && !delta?.tool_calls) {
                  // Some models output their tool calls as JSON in the reasoning field
                  // We'll accumulate it and try to parse it as a tool call
                  const reasoningPiece = String(delta.reasoning);
                  content += reasoningPiece;
                  if (!suppressAssistantDelta) this.onProgress?.('assistant_delta', { text: reasoningPiece, snapshot: content });
                }
                
                if (delta?.content) {
                  const piece = String(delta.content);
                  content += piece;
                  // Stream snapshot of full content (preferred) and the latest piece
                  if (!suppressAssistantDelta) this.onProgress?.('assistant_delta', { text: piece, snapshot: content });
                }
                
                if (delta?.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    if (tc.index !== undefined) {
                      const key = `idx_${tc.index}`;
                      const isNewTool = !toolCallsById[key];

                      if (isNewTool) {
                        toolCallsById[key] = {
                          id: tc.id || `tool_${tc.index}`,
                          type: 'function' as const,
                          function: { name: '', arguments: '' }
                        };
                      }

                      if (tc.function?.name) {
                        toolCallsById[key].function.name = tc.function.name;

                        // Emit early notification when we first see the tool name
                        if (isNewTool && !suppressAssistantDelta) {
                          this.onProgress?.('toolCalls', { toolCalls: [toolCallsById[key]] });
                        }
                      }

                      if (tc.function?.arguments) {
                        const argFragment = tc.function.arguments;
                        toolCallsById[key].function.arguments += argFragment;

                        // Stream parameter updates
                        if (!suppressAssistantDelta) {
                          this.onProgress?.('tool_param_delta', {
                            toolId: toolCallsById[key].id,
                            partialArguments: toolCallsById[key].function.arguments
                          });
                        }
                      }
                    } else if (tc.id) {
                      if (currentToolCall && toolCallBuffer && currentToolCall.function && currentToolCall.id) {
                        currentToolCall.function.arguments = toolCallBuffer;
                        toolCallsById[currentToolCall.id] = currentToolCall as ToolCall;
                      }
                      currentToolCall = {
                        id: tc.id,
                        type: 'function' as const,
                        function: {
                          name: tc.function?.name || '',
                          arguments: ''
                        }
                      };
                      toolCallBuffer = tc.function?.arguments || '';

                      // Emit early notification for new tool call
                      if (!suppressAssistantDelta && currentToolCall.function?.name) {
                        this.onProgress?.('toolCalls', { toolCalls: [currentToolCall as ToolCall] });
                      }
                    } else if (tc.function?.arguments) {
                      const argFragment = tc.function.arguments;
                      toolCallBuffer += argFragment;

                      // Stream parameter updates for current tool call
                      if (!suppressAssistantDelta && currentToolCall) {
                        this.onProgress?.('tool_param_delta', {
                          toolId: currentToolCall.id,
                          partialArguments: toolCallBuffer
                        });
                      }
                    }
                    
                    if (tc.function?.name && currentToolCall && currentToolCall.function) {
                      currentToolCall.function.name = tc.function.name;
                    }
                  }
                }
              }
              
              // Parse usage info
              if (json.usage) {
                usageInfo = {
                  promptTokens: json.usage.prompt_tokens || 0,
                  completionTokens: json.usage.completion_tokens || 0,
                  totalTokens: json.usage.total_tokens || 0,
                  cachedTokens: json.usage.cached_tokens,
                  model: this.getProviderConfig().model,
                  provider
                };
              }
              
              if (json.x_groq?.usage) {
                usageInfo = {
                  promptTokens: json.x_groq.usage.prompt_tokens || 0,
                  completionTokens: json.x_groq.usage.completion_tokens || 0,
                  totalTokens: json.x_groq.usage.total_tokens || 0,
                  model: this.getProviderConfig().model,
                  provider
                };
              }
            } catch (error) {
              if (data && data.length > 10 && !data.includes('[DONE]')) {
                logger.warn('[Orchestrator] Parse error in streaming response:', error, 'Data snippet:', data.substring(0, 200));
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error reading stream:', error);
      if (Object.keys(toolCallsById).length > 0) {
        if (currentToolCall && toolCallBuffer && currentToolCall.function && currentToolCall.id) {
          currentToolCall.function.arguments = toolCallBuffer;
          toolCallsById[currentToolCall.id] = currentToolCall as ToolCall;
        }
      }
    }
    
    // Check if content contains a JSON tool call (for models that don't support function calling)
    if (content) {
      logger.debug(`[Orchestrator] Checking content for tool calls`, {
        contentLength: content.length,
        existingToolCalls: Object.keys(toolCallsById).length,
        hasToolKeywords: content.includes('json_patch') || content.includes('evaluation')
      });
    }
    
    if (content && Object.keys(toolCallsById).length === 0) {
      // Handle special reasoning format like <|channel|>analysis<|message|>...
      let processedContent = content;
      if (content.includes('<|channel|>') && content.includes('<|message|>')) {
        // Extract the actual tool call from the reasoning format
        // Pattern 1: to=functions.apply_patch followed by JSON
        let reasoningMatch = content.match(/to=functions\.(\w+)[\s\S]*?<\|message\|>([\s\S]*?)(?:<\|[^>]*\||$)/);
        if (reasoningMatch) {
          const toolName = reasoningMatch[1];
          const jsonContent = reasoningMatch[2];
          
          try {
            const parsed = JSON.parse(jsonContent.trim());
            // Convert to a tool call
            toolCallsById['manual_1'] = {
              id: 'manual_1',
              type: 'function',
              function: {
                name: toolName,
                arguments: JSON.stringify(parsed)
              }
            };
            // Clean the content
            processedContent = content.replace(reasoningMatch[0], '').trim();
          } catch (error) {
            logger.debug('Failed to parse reasoning format JSON:', error);
          }
        } else {
          // Pattern 2: commentary to=functions.shell followed by JSON  
          reasoningMatch = content.match(/commentary to=functions\.(\w+)[\s\S]*?<\|constrain\|>json<\|message\|>([\s\S]*?)(?:<\|[^>]*\||$)/);
          if (reasoningMatch) {
            const jsonContent = reasoningMatch[2];
            
            try {
              const parsed = JSON.parse(jsonContent.trim());
              toolCallsById['manual_1'] = {
                id: 'manual_1',
                type: 'function',
                function: {
                  name: 'shell',
                  arguments: JSON.stringify(parsed)
                }
              };
              processedContent = content.replace(reasoningMatch[0], '').trim();
            } catch (error) {
              logger.debug('Failed to parse commentary reasoning format JSON:', error);
            }
          }
        }
      }
      
      // Try to find JSON objects in the content
      const patterns = [
        /\{[^{}]*"cmd"\s*:\s*\[[^\]]*\][^{}]*\}/,  // Standard JSON with cmd
        /\{"cmd":\s*\[.*?\]\}/,  // Simpler pattern
        /\{.*?"cmd".*?\}/  // Most permissive
      ];
      
      for (const pattern of patterns) {
        const jsonMatch = processedContent.match(pattern);
        if (jsonMatch) {
          logger.debug(`[Orchestrator] Found JSON match with pattern`, { 
            pattern: pattern.toString(), 
            jsonPreview: jsonMatch[0].substring(0, 200) 
          });
          try {
            const jsonStr = jsonMatch[0];
            const parsed = JSON.parse(jsonStr);
            if (parsed.cmd && Array.isArray(parsed.cmd)) {
              // Fix common command mistakes
              let cmd = parsed.cmd;
              // Convert bash -lc or bash -c to direct command
              if (cmd[0] === 'bash' && cmd[1] && cmd[1].startsWith('-')) {
                // Extract the actual command from bash -c "command"
                if (cmd[2]) {
                  // Parse the bash command string
                  const bashCmd = cmd[2].trim();
                  // Split it into proper command array
                  cmd = bashCmd.split(/\s+/);
                  parsed.cmd = cmd;
                }
              }
              
              // Convert to a tool call (only if we didn't already create one from reasoning format)
              if (!toolCallsById['manual_1']) {
                toolCallsById['manual_1'] = {
                  id: 'manual_1', 
                  type: 'function',
                  function: {
                    name: 'shell',
                    arguments: JSON.stringify(parsed)
                  }
                };
              }
              // Remove the JSON from content but keep any other text
              processedContent = processedContent.replace(jsonStr, '').trim();
              break;
            }
          } catch (error) {
            logger.debug('Failed to parse potential tool JSON:', error);
          }
        }
      }
      
      // Update content with the processed version
      content = processedContent;
    }
    
    // Clean up reasoning format markers from content for better chat display
    if (content.includes('<|channel|>') || content.includes('<|message|>') || content.includes('<|end|>') || content.includes('<|start|>')) {
      content = content
        .replace(/<\|channel\|>[^<]*<\|message\|>/g, '') // Remove channel/message tags
        .replace(/<\|end\|><\|start\|>assistant<\|channel\|>[^<]*<\|message\|>/g, '') // Remove assistant reasoning transitions
        .replace(/<\|call\|>/g, '') // Remove call markers
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
    }
    
    // Validate tool calls have complete JSON arguments
    if (Object.keys(toolCallsById).length > 0) {
      logger.debug(`[Orchestrator] Found ${Object.keys(toolCallsById).length} tool calls before validation`, Object.keys(toolCallsById));
    }
    
    const toolCallsArray = Object.values(toolCallsById).map((toolCall) => {
      if (toolCall.function?.arguments) {
        try {
          // Validate JSON is complete
          JSON.parse(toolCall.function.arguments);
          logger.debug(`[Orchestrator] Tool call ${toolCall.id} validated successfully: ${toolCall.function.name}`);
        } catch {
          if (DEBUG_TOOL_STREAM) logger.warn('Incomplete tool arguments detected, attempting to fix');
          // Try to fix truncated JSON
          const args = toolCall.function.arguments;
          const openBraces = (args.match(/{/g) || []).length;
          const closeBraces = (args.match(/}/g) || []).length;
          const openBrackets = (args.match(/\[/g) || []).length;
          const closeBrackets = (args.match(/]/g) || []).length;
          
          let suffix = '';
          for (let i = 0; i < openBrackets - closeBrackets; i++) suffix += ']';
          for (let i = 0; i < openBraces - closeBraces; i++) suffix += '}';
          
          if (suffix) {
            toolCall.function.arguments = args + suffix;
            if (DEBUG_TOOL_STREAM) logger.warn('Added missing closing characters:', suffix);
          }
        }
      }
      return toolCall;
    });
    
    // Update cost tracking if we have usage info
    if (usageInfo && provider) {
      const providerConfig = this.getProviderConfig();
      const providerModel = providerConfig.model;

      if (!usageInfo.provider) {
        usageInfo.provider = provider;
      }

      if (!usageInfo.model) {
        usageInfo.model = providerModel;
      }

      const cost = CostCalculator.calculateCost(usageInfo, provider, providerModel, true);
      usageInfo.cost = cost;
      
      this.totalUsage.promptTokens += usageInfo.promptTokens;
      this.totalUsage.completionTokens += usageInfo.completionTokens;
      this.totalUsage.totalTokens += usageInfo.totalTokens;
      this.totalCost += cost;
      
      configManager.updateSessionCost(usageInfo, cost);
      
      const sessionId = configManager.getCurrentSession()?.sessionId;
      // Skip cost tracking for test projects to avoid race conditions
      if (!this.projectId.startsWith('test-')) {
        vfs.updateProjectCost(this.projectId, {
          cost,
          provider: usageInfo.provider || provider || 'unknown',
          tokenUsage: {
            input: usageInfo.promptTokens,
            output: usageInfo.completionTokens
          },
          sessionId,
          mode: 'absolute'
        }).catch(err => logger.error('Failed to update project cost:', err));
      }
      
      this.onProgress?.('usage', { usage: usageInfo, totalCost: this.totalCost });
      
      // For OpenRouter, queue generation API call for accurate cost tracking
      if ((provider === 'openrouter' || provider.includes('openrouter')) && usageInfo.generationId && usageInfo.isEstimated !== false) {
        const apiKey = configManager.getProviderApiKey('openrouter');
        if (apiKey) {
          GenerationAPIService.queueGenerationForCostUpdate(
            usageInfo.generationId,
            apiKey,
            this.projectId,
            provider,
            providerModel,
            (actualCost: number, generationUsage: GenerationUsage) => {
              // Update usage with accurate cost
              const correctedUsage = CostCalculator.updateWithGenerationApiCost(usageInfo, {
                total_cost: actualCost,
                native_tokens_total: generationUsage.native_tokens_total,
                native_tokens_prompt: generationUsage.native_tokens_prompt,
                native_tokens_completion: generationUsage.native_tokens_completion
              });
              
              // Update session cost with correction
              const costDifference = actualCost - cost;
              if (Math.abs(costDifference) > 0.0001) {
                this.totalCost += costDifference;
                const providerKey = correctedUsage.provider || provider || 'unknown';
                configManager.adjustSessionCost(providerKey, costDifference);
                
                // Update project cost with correction
                if (!this.projectId.startsWith('test-')) {
                  vfs.applyProjectCostDelta(this.projectId, {
                    costDelta: costDifference,
                    provider: providerKey,
                    sessionId
                  }).catch(err => logger.error('Failed to apply corrected project cost:', err));
                }
                
                // Notify UI of cost correction
                this.onProgress?.('cost_correction', { 
                  originalCost: cost, 
                  actualCost, 
                  difference: costDifference,
                  usage: correctedUsage,
                  totalCost: this.totalCost
                });
              }
            }
          );
        }
      }
    }
    
    logger.debug(`[Orchestrator] Final response`, {
      contentLength: content.length,
      toolCallsCount: toolCallsArray.length,
      toolCalls: toolCallsArray.map(tc => ({ id: tc.id, name: tc.function?.name, argsLength: tc.function?.arguments?.length }))
    });
    
    return { content, toolCalls: toolCallsArray, usage: usageInfo };
  }

  private async ensurePricing(provider: string, model: string): Promise<void> {
    const key = `${provider}:${model}`;
    if (this.pricingEnsured.has(key)) {
      return;
    }

    if (provider !== 'openrouter') {
      this.pricingEnsured.add(key);
      return;
    }

    if (configManager.getModelPricing('openrouter', model)) {
      this.pricingEnsured.add(key);
      return;
    }

    const cachedModels = configManager.getCachedModels('openrouter');
    if (cachedModels?.models?.length) {
      registerPricingFromProviderModels('openrouter', cachedModels.models);
      if (configManager.getModelPricing('openrouter', model)) {
        this.pricingEnsured.add(key);
        return;
      }
    }

    try {
      const models = await fetchAvailableModels();
      registerOpenRouterPricingFromApi(models);
      if (configManager.getModelPricing('openrouter', model)) {
        this.pricingEnsured.add(key);
      }
    } catch (error) {
      logger.warn('[Orchestrator] Failed to fetch pricing metadata', error);
    }
  }

  /**
   * Debug logging helper
   */
  private debug(...args: unknown[]) {
    logger.debug(...args);
  }
  
  /**
   * Get available tools (filtered by chat mode)
   */
  private getAvailableTools(): ToolDefinition[] {
    if (this.chatMode) {
      // Chat mode: only shell tool (read-only commands)
      return [SHELL_TOOL_DEF];
    }
    // Code mode: all tools
    return [SHELL_TOOL_DEF, JSON_PATCH_TOOL_DEF, EVALUATION_TOOL_DEF];
  }
  
  /**
   * Execute task
   */
  async execute(userPrompt: string): Promise<OrchestratorResult> {
    logger.info(`[Orchestrator] Starting execution with prompt`, { promptPreview: userPrompt.substring(0, 100) });

    // Reset state for new execution
    this.evaluationRequested = false;
    this.evaluationReceived = false;
    this.globalToolIndex = 0; // Reset tool index for new user message
    this.lastToolCallSignature = null; // Reset loop detection for new execution

    try {
      // Snapshot current state before running tools
      await this.recordAutoCheckpoint(`Before prompt: ${userPrompt.substring(0, 60)}`);

      // Get file tree for context (optional)
      let fileTree: string | undefined;
      try {
        const files = await vfs.listDirectory(this.projectId, '/');
        if (files.length > 0) {
          fileTree = this.buildFileTree(files);
        }
      } catch {
        // Ignore errors getting file tree
      }

      let systemPrompt = buildShellSystemPrompt(fileTree, this.chatMode);

      // Initialize conversation with system prompt if empty
      if (this.conversation.length === 0) {
        this.conversation.push({
          role: 'system',
          content: systemPrompt
        });
      }

      // Add user prompt to conversation
      this.conversation.push({
        role: 'user',
        content: userPrompt
      });

      // Main execution loop
      for (let iterations = 0; iterations < this.maxIterations; iterations++) {
        // Check if generation was stopped
        if (this.stopped) {
          logger.info('[Orchestrator] Execution stopped by user request');
          await this.recordAutoCheckpoint('Generation stopped before completion');
          return {
            success: false,
            summary: 'Generation stopped by user',
            stepsCompleted: this.stepsCompleted,
            checkpointId: this.lastCheckpointId ?? undefined,
            conversation: this.conversation,
            totalCost: this.totalCost,
            usageInfo: this.totalUsage
          };
        }

        this.onProgress?.('iteration', { 
          current: iterations + 1, 
          max: this.maxIterations,
          stepsCompleted: this.stepsCompleted 
        });
        
        const { provider, apiKey, model } = this.getProviderConfig();
        const tools = this.getAvailableTools();

        // Notify UI that we're waiting for LLM response
        this.onProgress?.('thinking', {});

        // Call LLM with conversation and tools
        const response = await this.streamLLMResponse(
          this.conversation,
          tools,
          provider,
          apiKey,
          model
        );
        
        logger.debug(`[Orchestrator] Iteration ${iterations + 1} - Response`, {
          hasContent: !!response.content,
          contentLength: response.content?.length || 0,
          contentPreview: response.content?.substring(0, 200),
          toolCallsCount: response.toolCalls?.length || 0,
          toolCalls: response.toolCalls?.map(tc => ({
            name: tc.function?.name,
            args: tc.function?.arguments?.substring(0, 100)
          }))
        });
        
        // Handle empty or content-only responses
        if (!response.toolCalls || response.toolCalls.length === 0) {
          logger.debug(`[Orchestrator] No tool calls in response`);

          if (response.content && response.content.trim()) {
            // Add assistant's response to conversation
            this.conversation.push({
              role: 'assistant',
              content: response.content
            });

            // If meaningful work done (3+ steps), request evaluation (only in code mode)
            if (!this.chatMode && this.stepsCompleted >= 3 && !this.evaluationRequested && !this.evaluationReceived) {
              logger.debug(`[Orchestrator] Requesting evaluation after ${this.stepsCompleted} steps`);
              this.evaluationRequested = true;
              this.conversation.push({
                role: 'user',
                content: 'Please use the evaluation tool to assess if the task has been completed successfully. Include progress_summary, remaining_work, and any blockers.'
              });
              continue; // Give LLM one more iteration to evaluate
            }

            // If we received evaluation and should stop, break
            if (this.evaluationReceived) {
              const shouldStop = this.taskComplete || this.evaluationResult?.shouldContinue === false;
              if (shouldStop) {
                logger.info(`[Orchestrator] Breaking: evaluation complete, should not continue`);
                break;
              }
              // Evaluation received but should continue, reset and proceed
              logger.debug(`[Orchestrator] Evaluation received but should_continue=true, continuing...`);
              this.evaluationReceived = false;
            }

            // If we requested evaluation but didn't get it after multiple tries, break
            if (this.evaluationRequested) {
              logger.info(`[Orchestrator] Breaking: evaluation requested but not provided`);
              break;
            }

            // For simple tasks (< 3 steps), try to force tool usage if no progress
            if (this.stepsCompleted === 0) {
              this.noToolCallRetries++;
              logger.debug(`[Orchestrator] No progress made, retry ${this.noToolCallRetries}/2`);
              if (this.noToolCallRetries <= 2) {
                // Notify UI about retry
                this.onProgress?.('retry', {
                  reason: 'No progress made, prompting for action',
                  attempt: this.noToolCallRetries,
                  maxAttempts: 2
                });

                this.conversation.push({
                  role: 'user',
                  content: 'Please proceed with the implementation using the shell tool.'
                });
                continue;
              }
            }
          }

          // No tool calls - request evaluation to check if task is complete (only in code mode)
          if (!this.chatMode && !this.evaluationRequested && !this.evaluationReceived) {
            // Request evaluation regardless of steps - let evaluation tool assess completion
            logger.debug(`[Orchestrator] No tool calls after ${this.stepsCompleted} steps, requesting evaluation`);
            this.evaluationRequested = true;
            this.conversation.push({
              role: 'user',
              content: 'Please use the evaluation tool to assess if the task has been completed successfully. Include progress_summary, remaining_work, and any blockers.'
            });
            continue;
          }

          // Evaluation already requested but not received - break
          logger.info(`[Orchestrator] Breaking: evaluation requested but no response. Steps completed: ${this.stepsCompleted}`);
          break;
        }
        
        // Notify about tool calls
        if (response.toolCalls && response.toolCalls.length > 0) {
          logger.debug(`[Orchestrator] Sending ${response.toolCalls.length} tool calls to UI`);
          this.onProgress?.('toolCalls', { toolCalls: response.toolCalls });
        }
        
        // Execute tool calls
        let toolResults;
        try {
          toolResults = await this.executeToolCalls(response.toolCalls, iterations);
          // Reset malformed tool call counter on successful tool calls
          this.malformedToolCallRetries = 0;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(`[Orchestrator] Tool execution error:`, errorMessage);
          if (errorMessage.includes('Malformed tool call')) {
            this.malformedToolCallRetries++;
            logger.debug(`[Orchestrator] Malformed tool call, retry ${this.malformedToolCallRetries}/2`);
            if (this.malformedToolCallRetries <= 2) {
              // Notify UI about retry
              this.onProgress?.('retry', {
                reason: 'Malformed JSON in tool call',
                attempt: this.malformedToolCallRetries,
                maxAttempts: 2
              });

              // Add error feedback to conversation
              this.conversation.push({
                role: 'user',
                content: `Error: ${errorMessage}. Please fix the tool call format and try again.`
              });
              continue;
            }
          }
          throw error;
        }
        
        // Add assistant's message with tool calls
        if (response.content || response.toolCalls.length > 0) {
          const assistantMessage: OrchestratorMessage = {
            role: 'assistant',
            content: response.content || ''
          };
          if (response.toolCalls.length > 0) {
            assistantMessage.tool_calls = response.toolCalls;
          }
          this.conversation.push(assistantMessage);
        }
        
        // Add tool results to conversation
        for (const result of toolResults) {
          this.conversation.push(result);
        }
        
        // Accumulate tool calls for summary
        this.accumulatedToolCalls.push(...response.toolCalls);
        
        // Check for evaluation tool call
        const evalCall = response.toolCalls.find((tc) => tc.function?.name === 'evaluation');
        if (evalCall) {
          try {
            const args = JSON.parse(evalCall.function.arguments);
            this.evaluationResult = {
              goalAchieved: args.goal_achieved || false,
              reasoning: args.reasoning || '',
              progressSummary: args.progress_summary || '',
              remainingWork: args.remaining_work || [],
              blockers: args.blockers || []
            };

            if (args.goal_achieved) {
              logger.info(`[Orchestrator] Task marked complete by evaluation`);
              this.taskComplete = true;
              break;
            }
          } catch (error) {
            logger.error('Failed to parse evaluation result:', error);
          }
        }

        // Check if task is complete
        if (this.taskComplete || this.stepsCompleted >= 50) {
          logger.info(`[Orchestrator] Breaking: taskComplete=${this.taskComplete}, steps=${this.stepsCompleted}`);
          break;
        }
      }
      
      logger.info(`[Orchestrator] Execution completed after ${this.maxIterations} iterations max. Steps: ${this.stepsCompleted}`);
      
      // Generate summary
      const summary = this.generateSummary();
      await this.recordAutoCheckpoint(`After completion: ${userPrompt.substring(0, 60)}`);
      
      return {
        success: this.stepsCompleted > 0,
        summary,
        stepsCompleted: this.stepsCompleted,
        checkpointId: this.lastCheckpointId ?? undefined,
        conversation: this.conversation,
        totalCost: this.totalCost,
        usageInfo: this.totalUsage
      };
      
    } catch (error) {
      logger.error('Orchestrator error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;

      // Log full error details for debugging
      logger.error('Full orchestrator error details:', {
        message: errorMessage,
        stack: errorStack,
        stepsCompleted: this.stepsCompleted,
        chatMode: this.chatMode
      });

      try {
        await this.recordAutoCheckpoint(`After failure: ${userPrompt.substring(0, 60)}`);
      } catch (checkpointError) {
        logger.warn('Failed to record checkpoint after error', checkpointError);
      }

      return {
        success: false,
        summary: `Error: ${errorMessage}`,
        stepsCompleted: this.stepsCompleted,
        checkpointId: this.lastCheckpointId ?? undefined,
        conversation: this.conversation,
        totalCost: this.totalCost,
        usageInfo: this.totalUsage
      };
    }
  }
  
  /**
   * Generate a normalized signature for a tool call to detect duplicates
   */
  private getToolCallSignature(toolCall: ToolCall): string {
    const toolName = toolCall.function?.name || 'unknown';

    try {
      const args = JSON.parse(toolCall.function.arguments);

      // Normalize the arguments for comparison
      if (toolName === 'shell') {
        // Normalize cmd to string format for consistent comparison
        const cmd = Array.isArray(args.cmd)
          ? args.cmd.join(' ')
          : String(args.cmd || '');
        return `shell:${cmd}`;
      }

      // For other tools, use JSON string of sorted keys
      const sortedArgs = JSON.stringify(args, Object.keys(args).sort());
      return `${toolName}:${sortedArgs}`;
    } catch {
      // If we can't parse arguments, use raw arguments string
      return `${toolName}:${toolCall.function.arguments}`;
    }
  }

  /**
   * Execute tool calls and update progress
   */
  private async executeToolCalls(toolCalls: ToolCall[], iteration: number): Promise<OrchestratorMessage[]> {
    const toolResults: OrchestratorMessage[] = [];

    for (let i = 0; i < toolCalls.length; i++) {
      // Check if generation was stopped
      if (this.stopped) {
        logger.info('[Orchestrator] Tool execution stopped by user request');
        break;
      }

      const toolCall = toolCalls[i];
      const toolName = toolCall.function?.name;
      const toolId = toolCall.id;

      // Use global tool index that accumulates across all LLM calls in this execution
      const currentToolIndex = this.globalToolIndex;
      this.globalToolIndex++;

      // Check for consecutive duplicate tool calls (loop detection)
      const currentSignature = this.getToolCallSignature(toolCall);
      if (this.lastToolCallSignature === currentSignature) {
        // Loop detected - inject intervention message
        logger.warn(`[Orchestrator] Loop detected: consecutive duplicate tool call - ${currentSignature}`);

        const interventionMessage = `❌ Loop detected: You just called this exact same command twice in a row.

This suggests you may be stuck. The previous call likely failed or didn't produce the expected result.

🔄 Last call: ${toolName} with parameters ${toolCall.function.arguments.substring(0, 200)}${toolCall.function.arguments.length > 200 ? '...' : ''}

💡 Suggestions:
• If the command failed with an error, try a completely different approach
• For regex errors: use simpler patterns or try a different tool (e.g., cat + analyze)
• For file operations: verify the file/path exists first
• For search operations: try broader search terms or different search methods

Please try a different approach instead of repeating the same command.`;

        toolResults.push({
          role: 'tool',
          tool_call_id: toolId,
          content: interventionMessage
        });

        // Update tool status to failed
        this.onProgress?.('tool_status', {
          toolIndex: currentToolIndex,
          status: 'failed',
          error: 'Loop detected - duplicate tool call'
        });

        // Reset tracking so next call is fresh
        this.lastToolCallSignature = null;

        // Skip executing this duplicate call
        continue;
      }

      // Update last tool call signature
      this.lastToolCallSignature = currentSignature;

      // Update tool status to executing
      this.onProgress?.('tool_status', {
        toolIndex: currentToolIndex,
        status: 'executing'
      });
      
      if (toolName === 'shell') {
        try {
          // Parse arguments
          let args;
          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch {
            throw new Error(`Malformed tool call - invalid JSON in arguments.

The arguments must be valid JSON. Common issues:
❌ Trailing commas: {"cmd": ["ls", "/"]}
❌ Unescaped quotes: {"cmd": ["echo", "Hello "World""]}
❌ Missing quotes: {cmd: ["ls", "/"]}
✅ Correct: {"cmd": ["ls", "/"]}`);
          }
          
          if (!args.cmd) {
            throw new Error(`Malformed tool call - cmd parameter is required.

✅ Natural format: {"cmd": "ls -la /"}
✅ Array format: {"cmd": ["ls", "-la", "/"]}

Examples:
- {"cmd": "cat /index.html"} - Read a file
- {"cmd": ["rg", "-C", "5", "pattern", "/"]} - Search with context
- {"cmd": "head -n 50 /app.js"} - Sample file start
- {"cmd": ["tree", "-L", "2", "/"]} - Show directory structure`);
          }
          
          // Convert cmd to array format if it's a string
          let cmdArray: string[];
          if (typeof args.cmd === 'string') {
            cmdArray = parseShellCommand(args.cmd);
            logger.debug(`[Orchestrator] Converted string command "${args.cmd}" to array:`, cmdArray);
          } else if (Array.isArray(args.cmd)) {
            cmdArray = args.cmd;
          } else {
            throw new Error(`Malformed tool call - cmd must be string or array.

✅ Natural format: {"cmd": "ls -la /"}
✅ Array format: {"cmd": ["ls", "-la", "/"]}

Examples:
- {"cmd": "cat /index.html"} - Natural format
- {"cmd": ["cat", "/index.html"]} - Array format
- {"cmd": "ls -la /"} - Natural format  
- {"cmd": ["ls", "-la", "/"]} - Array format`);
          }
          
          // Execute tool command
          logger.debug(`[Orchestrator] Executing shell command: ${cmdArray[0]}`);
          logger.debug(`[Orchestrator] Routing to executeShellCommand`);
          const result = await this.executeShellCommand(cmdArray);
          logger.debug(`[Orchestrator] Command result length:`, result?.length);
          
          toolResults.push({
            role: 'tool',
            tool_call_id: toolId,
            content: result
          });
          
          this.stepsCompleted++;
          
          // Check if patch failed based on result content
          const isFailure = result.startsWith('❌');
          
          // Update tool status
          this.onProgress?.('tool_status', {
            toolIndex: currentToolIndex,
            status: isFailure ? 'failed' : 'completed',
            result: result
          });

          // Send tool result as progress event
          logger.debug(`[Orchestrator] Sending tool result for tool ${currentToolIndex}`, { resultPreview: result.substring(0, 100) });
          this.onProgress?.('tool_result', {
            toolIndex: currentToolIndex,
            toolId: toolId,
            result: result
          });
          
          // Check if this was a write operation
          const isWriteOp = this.isWriteOperation(args.cmd);
          const isStructureOp = this.isFileStructureOperation(args.cmd);
          
          if (isWriteOp) {
            this.lastIterationHadWrite = true;
            // Create checkpoint after write operations
            await this.recordAutoCheckpoint(`After step ${this.stepsCompleted}`);
          } else {
            this.lastIterationHadWrite = false;
          }
          
          // Trigger file explorer refresh for operations that alter file structure
          if (isStructureOp) {
            this.triggerFileExplorerRefresh();
          }
          
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          toolResults.push({
            role: 'tool',
            tool_call_id: toolId,
            content: `Error: ${errorMessage}`
          });
          
          // Update tool status to failed
          this.onProgress?.('tool_status', {
            toolIndex: currentToolIndex,
            status: 'failed',
            error: errorMessage
          });
        }
      } else if (toolName === 'json_patch') {
        // Handle json_patch tool calls
        try {
          const args = JSON.parse(toolCall.function.arguments);
          logger.debug(`[Orchestrator] Executing json_patch call for ${args.file_path}`);
          
          const vfs = new VirtualFileSystem();
          await vfs.init();
          
          const result = await execStringPatch(vfs, this.projectId, args.file_path, args.operations);
          logger.debug(`[Orchestrator] String patch result:`, result);
          
          // Format result message
          let resultMessage = result.summary;
          if (result.warnings && result.warnings.length > 0) {
            resultMessage += '\n\nWarnings:\n' + result.warnings.map(w => `• ${w}`).join('\n');
          }
          
          toolResults.push({
            role: 'tool',
            tool_call_id: toolId,
            content: resultMessage
          });
          
          this.stepsCompleted++;
          
          // Update tool status
          this.onProgress?.('tool_status', {
            toolIndex: currentToolIndex, 
            status: result.applied ? 'completed' : 'failed',
            result: resultMessage
          });
          
          // Send tool result to UI
          this.onProgress?.('tool_result', {
            toolIndex: currentToolIndex,
            toolId: toolId,
            result: resultMessage
          });
          
          // Create checkpoint after successful patch operations
          if (result.applied) {
            await this.recordAutoCheckpoint(`After step ${this.stepsCompleted}`);
            this.triggerFileExplorerRefresh();
          }
          
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          toolResults.push({
            role: 'tool',
            tool_call_id: toolId,
            content: `Error: ${errorMessage}`
          });
          
          // Update tool status to failed
          this.onProgress?.('tool_status', {
            toolIndex: currentToolIndex,
            status: 'failed',
            error: errorMessage
          });
        }
      } else if (toolName === 'evaluation') {
        // Handle evaluation tool (for self-assessment)
        try {
          const args = JSON.parse(toolCall.function.arguments);
          logger.debug(`[Orchestrator] Processing evaluation:`, args);

          // Set flag that evaluation was received
          this.evaluationReceived = true;
          this.evaluationRequested = false; // Reset request flag

          // Store evaluation result
          this.evaluationResult = {
            goalAchieved: args.goal_achieved,
            reasoning: args.reasoning,
            progressSummary: args.progress_summary,
            remainingWork: args.remaining_work,
            blockers: args.blockers,
            shouldContinue: args.should_continue
          };

          // Mark task as complete if evaluation indicates so
          if (args.goal_achieved === true) {
            logger.info(`[Orchestrator] Task marked complete by evaluation`);
            this.taskComplete = true;
          }

          toolResults.push({
            role: 'tool',
            tool_call_id: toolId,
            content: JSON.stringify(args)
          });

          // Update tool status to completed
          this.onProgress?.('tool_status', {
            toolIndex: currentToolIndex,
            status: 'completed',
            result: JSON.stringify(args)
          });

        } catch (error) {
          const parseError = error instanceof Error ? error.message : String(error);
          const errorMessage = `Error parsing evaluation: ${parseError}

✅ Correct format:
{
  "goal_achieved": true,
  "progress_summary": "Completed hero section with CTA, features grid with 6 items",
  "remaining_work": ["Add pricing section", "Create footer"],
  "blockers": [],
  "reasoning": "Hero and features complete. Next: pricing section.",
  "should_continue": true
}

Required fields:
• goal_achieved (boolean) - Whether the original task is fully complete
• progress_summary (string) - Brief summary of work completed so far
• remaining_work (array of strings) - Specific tasks still needed (empty if goal_achieved is true)
• reasoning (string) - Detailed explanation of current status and next steps
• should_continue (boolean) - Whether to continue working

Optional field:
• blockers (array of strings) - Current blockers preventing progress`;

          toolResults.push({
            role: 'tool',
            tool_call_id: toolId,
            content: `Error: ${errorMessage}`
          });

          // Update tool status to failed
          this.onProgress?.('tool_status', {
            toolIndex: currentToolIndex,
            status: 'failed',
            error: errorMessage
          });
        }
      } else {
        // Unknown tool name
        const errorMessage = `Unknown tool: ${toolName}

Available tools are: shell, json_patch, evaluation

✅ Shell tool (execute commands):
   {"name": "shell", "arguments": "{\\"cmd\\": \\"ls -la /\\"}"}

✅ JSON patch tool (edit files):
   {"name": "json_patch", "arguments": "{\\"file_path\\": \\"/index.html\\", \\"operations\\": [...]}"}

✅ Evaluation tool (assess progress):
   {"name": "evaluation", "arguments": "{\\"goal_achieved\\": true, \\"reasoning\\": \\"...\\"...}"}

Common mistakes:
❌ Wrong tool name: "shell<|channel|>analysis", "functions.shell", "command"
❌ Typos: "shelll", "json-patch", "evaluate"`;
        logger.warn(`[Orchestrator] ${errorMessage}`);
        toolResults.push({
          role: 'tool',
          tool_call_id: toolId,
          content: `Error: ${errorMessage}`
        });
        
        // Update tool status to failed
        this.onProgress?.('tool_status', {
          toolIndex: currentToolIndex, 
          status: 'failed',
          error: errorMessage
        });
      }
    }
    
    return toolResults;
  }

  /**
   * Record an auto checkpoint and update the latest checkpoint reference
   */
  private async recordAutoCheckpoint(description: string): Promise<Checkpoint> {
    const checkpoint = await checkpointManager.createCheckpoint(this.projectId, description, {
      kind: 'auto',
      baseRevisionId: saveManager.getSavedCheckpointId(this.projectId)
    });
    this.lastCheckpointId = checkpoint.id;
    return checkpoint;
  }

  /**
   * Execute shell command
   */
  private async executeShellCommand(cmd: string[]): Promise<string> {
    // Block write operations in chat mode
    if (this.chatMode && cmd.length > 0 && this.isWriteOperation(cmd)) {
      return `Error: Write operations are disabled in chat mode. "${cmd[0]}" is not allowed.

Switch to CODE mode to make file changes.

Read-only commands available: ls, tree, cat, head, tail, grep, rg, find`;
    }

    try {
      const result = await vfsShell.execute(this.projectId, cmd);
      
      if (result.success) {
        let output = (result.stdout && result.stdout.trim().length > 0)
          ? result.stdout
          : 'Command succeeded with no output';

        const program = cmd && cmd.length > 0 ? cmd[0] : undefined;
        if (program === 'cat') {
          const targetPath = cmd.length > 1 ? cmd[1] : undefined;
          if (targetPath) {
            const now = Date.now();
            const lastSeen = this.recentCatReads.get(targetPath);
            if (lastSeen && now - lastSeen < 30000) {
              const hint = `Hint: You already read ${targetPath} recently; reuse that context unless the file changed.`;
              output = `${hint}

${output}`;
            }
            const expiry = now - 120000;
            for (const [pathKey, timestamp] of this.recentCatReads) {
              if (timestamp < expiry) {
                this.recentCatReads.delete(pathKey);
              }
            }
            this.recentCatReads.set(targetPath, now);
          }
        } else if (program === 'nl') {
          let targetPath: string | undefined;
          for (let i = cmd.length - 1; i >= 1; i--) {
            const arg = cmd[i];
            if (!arg.startsWith('-')) {
              targetPath = arg;
              break;
            }
          }
          if (targetPath && output && output !== 'Command succeeded with no output') {
            output = `Hint: Avoid numbering the entire ${targetPath}. Reuse the snippet you already captured or run targeted slices (e.g., sed -n '30,60p' ${targetPath} | nl -ba). No content streamed.`;
          }
        }

        return output;
      } else {
        const message = (result.stderr && result.stderr.trim().length > 0) ? result.stderr : 'Command failed';
        return `Error: ${message}`;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return `Error: ${errorMessage}`;
    }
  }
  
  /**
   * Check if a command is a write operation
   */
  private isWriteOperation(cmd: string[]): boolean {
    if (!cmd || cmd.length === 0) return false;
    
    const writeCommands = ['mkdir', 'rm', 'rmdir', 'mv', 'cp'];
    return writeCommands.includes(cmd[0]);
  }
  
  /**
   * Check if a command alters file names or locations (needs file explorer refresh)
   */
  private isFileStructureOperation(cmd: string[]): boolean {
    if (!cmd || cmd.length === 0) return false;

    // Commands that change file structure (names, locations, create/delete)
    const structureCommands = ['mv', 'rm', 'rmdir', 'cp', 'mkdir', 'touch', 'echo'];
    return structureCommands.includes(cmd[0]);
  }
  
  /**
   * Trigger file explorer refresh
   */
  private triggerFileExplorerRefresh(): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('filesChanged'));
    }
  }
  
  /**
   * Build a tree structure from files with sizes
   */
  private buildFileTree(files: VirtualFile[]): string {
    if (files.length === 0) return '';

    // Build directory structure
    const tree = new Map<string, {
      isDirectory: boolean;
      size?: number;
      children: Set<string>;
    }>();

    // Add all directories and files to the tree
    for (const file of files) {
      const pathParts = file.path.split('/').filter(Boolean);
      
      // Add intermediate directories
      for (let i = 0; i < pathParts.length - 1; i++) {
        const dirPath = '/' + pathParts.slice(0, i + 1).join('/');
        if (!tree.has(dirPath)) {
          tree.set(dirPath, { isDirectory: true, children: new Set() });
        }
      }
      
      // Add file
      tree.set(file.path, { 
        isDirectory: false, 
        size: file.size,
        children: new Set() 
      });

      // Link child to parent
      const parentPath = '/' + pathParts.slice(0, -1).join('/');
      if (parentPath !== '/' && tree.has(parentPath)) {
        tree.get(parentPath)!.children.add(file.path);
      } else if (parentPath === '/') {
        // Root level items
        if (!tree.has('/')) {
          tree.set('/', { isDirectory: true, children: new Set() });
        }
        tree.get('/')!.children.add(file.path);
      }
    }

    // Helper function to format file size
    const formatSize = (bytes: number): string => {
      if (bytes === 0) return '0B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      const size = (bytes / Math.pow(k, i));
      
      // Format to 1 decimal place for KB/MB, no decimal for bytes
      const formatted = i === 0 ? size.toString() : size.toFixed(1);
      return formatted + sizes[i];
    };

    // Recursive function to build tree string
    const buildTreeString = (path: string, prefix: string = '', isLast: boolean = true): string[] => {
      const entry = tree.get(path);
      if (!entry) return [];

      const lines: string[] = [];
      const name = path === '/' ? '' : path.split('/').pop() || '';
      
      if (path !== '/') {
        const connector = isLast ? '└── ' : '├── ';
        const displayName = entry.isDirectory ? name + '/' : name;
        const sizeInfo = entry.isDirectory ? '' : ` (${formatSize(entry.size || 0)})`;
        lines.push(prefix + connector + displayName + sizeInfo);
      }

      // Sort children: directories first, then files, alphabetically
      const children = Array.from(entry.children).sort((a, b) => {
        const aEntry = tree.get(a);
        const bEntry = tree.get(b);
        if (aEntry?.isDirectory !== bEntry?.isDirectory) {
          return aEntry?.isDirectory ? -1 : 1;
        }
        return a.localeCompare(b);
      });

      children.forEach((childPath, index) => {
        const isLastChild = index === children.length - 1;
        const childPrefix = path === '/' ? '' : prefix + (isLast ? '    ' : '│   ');
        lines.push(...buildTreeString(childPath, childPrefix, isLastChild));
      });

      return lines;
    };

    const treeLines = buildTreeString('/');
    return treeLines.length > 0 ? 'Project Structure:\n' + treeLines.join('\n') : '';
  }

  /**
   * Generate a summary of the execution
   */
  private generateSummary(): string {
    if (this.evaluationResult) {
      let summary = '';

      // Use the last substantial assistant message as the summary
      const assistantContents: string[] = [];
      for (const msg of this.conversation) {
        if (msg.role === 'assistant' && msg.content && msg.content.trim().length > 50) {
          assistantContents.push(msg.content.trim());
        }
      }

      if (assistantContents.length > 0) {
        summary = assistantContents[assistantContents.length - 1];
      } else {
        summary = this.evaluationResult.reasoning;
      }

      // Append evaluation status
      if (this.evaluationResult.goalAchieved) {
        // Only add "Task Complete" if it's not already mentioned in the summary
        if (!summary.toLowerCase().includes('task complete') &&
            !summary.toLowerCase().includes('completed successfully')) {
          summary += '\n\n✅ Task Complete';
        }

        // Add created files summary if not already in the content
        const createdFiles = this.getCreatedFilesInSession();
        if (createdFiles.length > 0 && !summary.includes('Created/modified files:')) {
          summary += '\n\nCreated/modified files:';
          createdFiles.forEach(file => summary += `\n• ${file}`);
        }

        // Add next steps suggestion if not already mentioned
        if (!summary.toLowerCase().includes('next steps') &&
            !summary.toLowerCase().includes('open the preview')) {
          summary += '\n\nNext steps: Open the preview to test the application.';
        }
      } else {
        summary += '\n\n⚠️ Task Incomplete';

        if (this.evaluationResult.remainingWork && this.evaluationResult.remainingWork.length > 0) {
          summary += '\n\nRemaining work:';
          this.evaluationResult.remainingWork.forEach(work => summary += `\n• ${work}`);
        }

        if (this.evaluationResult.blockers && this.evaluationResult.blockers.length > 0) {
          summary += '\n\nBlockers:';
          this.evaluationResult.blockers.forEach(blocker => summary += `\n• ${blocker}`);
        }
      }

      return summary;
    }

    if (this.stepsCompleted === 0) {
      return 'No actions were taken.';
    }

    // Fallback summary for simple tasks
    const createdFiles = this.getCreatedFilesInSession();
    let summary = `Completed ${this.stepsCompleted} operation${this.stepsCompleted !== 1 ? 's' : ''}.`;

    if (createdFiles.length > 0) {
      summary += '\n\nCreated/modified files:';
      createdFiles.forEach(file => summary += `\n• ${file}`);
    }

    return summary;
  }

  /**
   * Track file operations during session
   */
  private getCreatedFilesInSession(): string[] {
    const files = new Set<string>();

    for (const toolCall of this.accumulatedToolCalls) {
      if (toolCall.function?.name === 'json_patch') {
        try {
          const args = JSON.parse(toolCall.function.arguments);
          if (args.file_path) files.add(args.file_path);
        } catch {}
      } else if (toolCall.function?.name === 'shell') {
        try {
          const args = JSON.parse(toolCall.function.arguments);
          const cmd = Array.isArray(args.cmd) ? args.cmd : [];

          // Track file creation commands
          if (cmd[0] === 'touch' && cmd[1]) {
            files.add(cmd[1]);
          }
          if (cmd[0] === 'mkdir' && cmd.includes('-p')) {
            const dirPath = cmd[cmd.length - 1];
            if (dirPath && dirPath.startsWith('/')) {
              files.add(dirPath + '/');
            }
          }
          // Track echo > file (file creation)
          if (cmd[0] === 'echo' && cmd.includes('>')) {
            const redirectIndex = cmd.indexOf('>');
            if (redirectIndex > 0 && cmd[redirectIndex + 1]) {
              files.add(cmd[redirectIndex + 1]);
            }
          }
        } catch {}
      }
    }

    return Array.from(files).sort();
  }
  
  /**
   * Get human-readable description of an operation
   */
  private getOperationDescription(operation: { name: string; parameters: Record<string, unknown> }): string {
    if (operation.name !== 'shell') return operation.name;
    
    const cmd: string[] = Array.isArray(operation.parameters?.cmd) ? operation.parameters.cmd : [];
    if (!cmd.length) return 'Executed shell';
    const c0 = (cmd[0] || '').toLowerCase();
    
    switch (c0) {
      case 'ls': return 'Listed files';
      case 'cat': return `Read ${cmd[1] || 'file'}`;
      case 'grep': return `Searched for patterns`;
      case 'find': return `Found files`;
      case 'mkdir': return `Created directory`;
      case 'rm': return `Removed ${cmd[1] || 'file'}`;
      case 'rmdir': return `Removed directory`;
      case 'mv': return `Moved ${cmd[1] || 'file'}`;
      case 'cp': return `Copied ${cmd[1] || 'file'}`;
      default: return `Executed: ${c0}`;
    }
  }
  
  /**
   * Perform task evaluation
   */
  private async performEvaluation(userPrompt: string): Promise<{ goalAchieved: boolean; reasoning: string; shouldContinue: boolean }> {
    // Build evaluation prompt
    const evalPrompt = `Review the task and determine if it has been completed successfully.

Original request: "${userPrompt}"

Steps completed: ${this.stepsCompleted}
Last operation had write: ${this.lastIterationHadWrite}

Recent conversation context:
${this.conversation.slice(-5).map(msg => `${msg.role}: ${msg.content?.substring(0, 200)}...`).join('\n')}

CRITICAL: You MUST respond with ONLY valid JSON in this exact format:
{
  "reasoning": "Brief explanation of why goal was/wasn't achieved",
  "goal_achieved": true or false,
  "should_continue": true or false
}

DO NOT include any other text, explanations, or formatting outside the JSON object.`;

    const { provider, apiKey, model } = this.getProviderConfig();
    
    const evalResponse = await this.streamLLMResponse(
      [
        { role: 'system', content: 'You are an objective evaluator. Respond ONLY with the requested JSON format.' },
        { role: 'user', content: evalPrompt }
      ],
      [], // No tools for evaluation
      provider,
      apiKey,
      model,
      { suppressAssistantDelta: true, maxTokens: 200 }
    );
    
    try {
      const result = JSON.parse(evalResponse.content || '{}');
      return {
        goalAchieved: result.goal_achieved === true,
        reasoning: result.reasoning || 'No reasoning provided',
        shouldContinue: result.should_continue !== false
      };
    } catch {
      logger.error('Failed to parse evaluation result:', evalResponse.content);
      // Default to continuing if we can't parse
      return {
        goalAchieved: false,
        reasoning: 'Could not determine goal achievement',
        shouldContinue: this.stepsCompleted < 3 // Continue if we haven't done much
      };
    }
  }
}

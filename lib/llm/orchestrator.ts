/**
 * Orchestrator - Handles AI task execution with tool support
 * Manages LLM communication, tool execution, checkpointing, and cost tracking
 */

import { vfs, VirtualFileSystem } from '@/lib/vfs';
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
  private evaluationResult: { goalAchieved: boolean; reasoning: string } | null = null;
  private malformedToolCallRetries = 0;
  private noToolCallRetries = 0;
  private lastIterationHadWrite = false;
  private lastCheckpointId: string | null = null;
  private recentCatReads = new Map<string, number>();
  private pricingEnsured = new Set<string>();
  
  constructor(
    projectId: string,
    existingConversation?: OrchestratorMessage[],
    onProgress?: (message: string, step?: unknown) => void
  ) {
    this.projectId = projectId;
    this.onProgress = onProgress;
    this.conversation = existingConversation || [];
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
    const model = configManager.getProviderModel(provider) || undefined;
    
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
    options?: { suppressAssistantDelta?: boolean; toolChoice?: 'auto' | 'required' | 'any'; maxTokens?: number }
  ): Promise<StreamResponse> {
    await this.ensurePricing(provider, model);

    const apiUrl = typeof window !== 'undefined' 
      ? `${window.location.origin}/api/generate`
      : '/api/generate';
    
    const requestBody = {
      messages,
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
      throw new Error(`API call failed: ${response.statusText}`);
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
                } else if (json.type === 'content_block_delta' && json.delta?.type === 'input_json_delta') {
                  const contentBlockIndex = json.index;
                  const toolId = contentBlockIndexToToolId[contentBlockIndex];
                  
                  if (toolId && json.delta.partial_json) {
                    anthropicToolBuffers[toolId] += json.delta.partial_json;
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
                      if (!toolCallsById[key]) {
                        toolCallsById[key] = {
                          id: tc.id || `tool_${tc.index}`,
                          type: 'function' as const,
                          function: { name: '', arguments: '' }
                        };
                      }
                      
                      if (tc.function?.name) {
                        toolCallsById[key].function.name = tc.function.name;
                      }
                      
                      if (tc.function?.arguments) {
                        const argFragment = tc.function.arguments;
                        toolCallsById[key].function.arguments += argFragment;
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
                    } else if (tc.function?.arguments) {
                      const argFragment = tc.function.arguments;
                      toolCallBuffer += argFragment;
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
   * Get available tools
   */
  private getAvailableTools(): ToolDefinition[] {
    return [SHELL_TOOL_DEF, JSON_PATCH_TOOL_DEF, EVALUATION_TOOL_DEF];
  }
  
  /**
   * Execute task
   */
  async execute(userPrompt: string): Promise<OrchestratorResult> {
    logger.info(`[Orchestrator] Starting execution with prompt`, { promptPreview: userPrompt.substring(0, 100) });
    try {
      // Snapshot current state before running tools
      await this.recordAutoCheckpoint(`Before prompt: ${userPrompt.substring(0, 60)}`);
      
      // Get file tree for context (optional)
      let fileTree: string | undefined;
      try {
        const files = await vfs.listDirectory(this.projectId, '/');
        if (files.length > 0) {
          fileTree = files.map(f => f.path).join('\n');
        }
      } catch {
        // Ignore errors getting file tree
      }
      
      const systemPrompt = buildShellSystemPrompt(fileTree);
      
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
            
            const lowercaseContent = response.content.toLowerCase();
            if (lowercaseContent.includes('complete') || 
                lowercaseContent.includes('done') ||
                lowercaseContent.includes('finished')) {
              this.taskComplete = true;
              break;
            }
            
            // Try to force tool usage if we haven't made progress
            if (this.stepsCompleted === 0) {
              this.noToolCallRetries++;
              logger.debug(`[Orchestrator] No progress made, retry ${this.noToolCallRetries}/2`);
              if (this.noToolCallRetries <= 2) {
                this.conversation.push({
                  role: 'user',
                  content: 'Please proceed with the implementation using the shell tool.'
                });
                continue;
              }
            }
          }
          
          this.noToolCallRetries++;
          logger.debug(`[Orchestrator] No tool calls, retry ${this.noToolCallRetries}/3`);
          if (this.noToolCallRetries <= 3) {
            this.conversation.push({
              role: 'user', 
              content: 'Continue with the task. If you need to perform more operations, use the available tools.'
            });
            continue;
          } else {
            logger.info(`[Orchestrator] Breaking: no tool calls and max retries reached. Steps completed: ${this.stepsCompleted}`);
            break;
          }
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
              reasoning: args.reasoning || ''
            };
            
            // Send evaluation divider to UI
            this.onProgress?.('divider', { title: 'Evaluation' });
            
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
      try {
        await this.recordAutoCheckpoint(`After failure: ${userPrompt.substring(0, 60)}`);
      } catch (checkpointError) {
        logger.warn('Failed to record checkpoint after error', checkpointError);
      }
      
      return {
        success: false,
        summary: `Task failed: ${errorMessage}`,
        stepsCompleted: this.stepsCompleted,
        checkpointId: this.lastCheckpointId ?? undefined,
        conversation: this.conversation,
        totalCost: this.totalCost,
        usageInfo: this.totalUsage
      };
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
      
      // Update tool status to executing
      this.onProgress?.('tool_status', { 
        toolIndex: i, 
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
          
          if (!args.cmd || !Array.isArray(args.cmd)) {
            throw new Error(`Malformed tool call - cmd must be an array.

❌ Wrong format: {"cmd": "[\"mkdir\", \"-p\", \"/pages\"]"}
✅ Correct format: {"cmd": ["mkdir", "-p", "/pages"]}

❌ Wrong: Using echo with redirection
✅ Correct: Use json_patch to create files

Examples:
- {"cmd": ["ls", "/"]} - List files
- {"cmd": ["mkdir", "/dirname"]} - Create directory  
- {"cmd": ["rm", "-rf", "/dirname"]} - Remove directory
- {"cmd": ["cat", "/file.txt"]} - Read file
- Use json_patch for file content, not shell redirection`);
          }
          
          // Execute tool command
          logger.debug(`[Orchestrator] Executing shell command: ${args.cmd[0]}`);
          logger.debug(`[Orchestrator] Routing to executeShellCommand`);
          const result = await this.executeShellCommand(args.cmd);
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
            toolIndex: i, 
            status: isFailure ? 'failed' : 'completed',
            result: result
          });
          
          // Send tool result as progress event
          logger.debug(`[Orchestrator] Sending tool result for tool ${i}`, { resultPreview: result.substring(0, 100) });
          this.onProgress?.('tool_result', {
            toolIndex: i,
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
            toolIndex: i, 
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
            toolIndex: i, 
            status: result.applied ? 'completed' : 'failed',
            result: resultMessage
          });
          
          // Send tool result to UI
          this.onProgress?.('tool_result', {
            toolIndex: i,
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
            toolIndex: i, 
            status: 'failed',
            error: errorMessage
          });
        }
      } else if (toolName === 'evaluation') {
        // Handle evaluation tool (for self-assessment)
        try {
          const args = JSON.parse(toolCall.function.arguments);
          logger.debug(`[Orchestrator] Processing evaluation:`, args);
          
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
            toolIndex: i, 
            status: 'completed',
            result: JSON.stringify(args)
          });
          
        } catch (error) {
          toolResults.push({
            role: 'tool',
            tool_call_id: toolId,
            content: `Error parsing evaluation: ${error}`
          });
          
          // Update tool status to failed
          this.onProgress?.('tool_status', { 
            toolIndex: i, 
            status: 'failed',
            error: `Error parsing evaluation: ${error}`
          });
        }
      } else {
        // Unknown tool name
        const errorMessage = `Unknown tool: ${toolName}`;
        logger.warn(`[Orchestrator] ${errorMessage}`);
        toolResults.push({
          role: 'tool',
          tool_call_id: toolId,
          content: `Error: ${errorMessage}`
        });
        
        // Update tool status to failed
        this.onProgress?.('tool_status', { 
          toolIndex: i, 
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
    const structureCommands = ['mv', 'rm', 'rmdir', 'cp', 'mkdir'];
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
   * Generate a summary of the execution
   */
  private generateSummary(): string {
    if (this.evaluationResult) {
      return this.evaluationResult.reasoning;
    }
    
    if (this.stepsCompleted === 0) {
      return 'No actions were taken.';
    }
    
    const operations = this.accumulatedToolCalls
      .filter(tc => tc.function?.name === 'shell')
      .map(tc => {
        try {
          const args = JSON.parse(tc.function.arguments);
          return this.getOperationDescription({ name: 'shell', parameters: args });
        } catch {
          return 'Unknown operation';
        }
      });
    
    if (operations.length === 0) {
      return `Completed ${this.stepsCompleted} step${this.stepsCompleted !== 1 ? 's' : ''}.`;
    }
    
    const uniqueOps = [...new Set(operations)];
    return `Completed ${this.stepsCompleted} step${this.stepsCompleted !== 1 ? 's' : ''}: ${uniqueOps.slice(0, 3).join(', ')}${uniqueOps.length > 3 ? '...' : ''}`;
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

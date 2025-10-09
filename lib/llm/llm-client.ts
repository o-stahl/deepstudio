
import { 
  LLMMessage, 
  ToolCall, 
  ToolDefinition,
  FileContext,
  StreamChunk,
  OpenRouterResponse,
  UsageInfo
} from './types';
import { buildShellSystemPrompt } from './system-prompt';
import { configManager } from '../config/storage';
import { ProviderId, ProviderConfig } from './providers/types';
import { getProvider } from './providers/registry';
import { GenerationAPIService } from './generation-api';
import { logger } from '../utils';

export interface LLMClientConfig {
  provider?: ProviderId;
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export class LLMClient {
  protected provider: ProviderId;
  protected providerConfig: ProviderConfig;
  protected apiKey: string;
  protected model: string;
  protected temperature: number;
  protected maxTokens: number;

  constructor(config?: LLMClientConfig) {
    this.provider = config?.provider || configManager.getSelectedProvider() || 'openrouter';
    this.providerConfig = getProvider(this.provider);
    
    this.apiKey = config?.apiKey || configManager.getProviderApiKey(this.provider) || '';
    
    this.model = config?.model || configManager.getProviderModel(this.provider) || this.getDefaultModel();
    
    this.temperature = config?.temperature || 0.7;
    this.maxTokens = config?.maxTokens || 4096;

  }

  private getDefaultModel(): string {
    switch (this.provider) {
      case 'openrouter':
        return 'deepseek/deepseek-chat';
      case 'openai':
        return 'gpt-4o-mini';
      case 'anthropic':
        return 'claude-3-5-haiku-20241022';
      case 'groq':
        return 'llama-3.3-70b-versatile';
      case 'gemini':
        return 'gemini-1.5-flash';
      case 'ollama':
        return 'llama3.2:latest';
      case 'lmstudio':
        return 'qwen/qwen3-4b-thinking-2507';
      case 'sambanova':
        return 'Meta-Llama-3.3-70B-Instruct';
      default:
        return '';
    }
  }

  async generateWithTools(
    prompt: string,
    tools: ToolDefinition[],
    context?: FileContext
  ): Promise<AsyncIterable<StreamChunk>> {
    if (this.providerConfig.apiKeyRequired && !this.apiKey) {
      throw new Error(`${this.providerConfig.name} API key is required. Please set it in settings.`);
    }

    const messages: LLMMessage[] = [
      { role: 'system', content: buildShellSystemPrompt(context?.fileTree) },
      {
        role: 'user',
        content: prompt
      }
    ];

    try {
      if (this.provider === 'anthropic') {
        return this.generateWithToolsAnthropic(messages, tools);
      } else if (this.provider === 'gemini') {
        return this.generateWithToolsGemini(messages, tools);
      } else {
        return this.generateWithToolsOpenAI(messages, tools);
      }
    } catch (error) {
      throw error;
    }
  }

  async generate(prompt: string, context?: FileContext): Promise<string> {
    if (this.providerConfig.apiKeyRequired && !this.apiKey) {
      throw new Error(`${this.providerConfig.name} API key is required. Please set it in settings.`);
    }

    const messages: LLMMessage[] = [
      { role: 'system', content: buildShellSystemPrompt(context?.fileTree) },
      {
        role: 'user',
        content: prompt
      }
    ];

    if (this.provider === 'anthropic') {
      return this.generateAnthropic(messages);
    } else if (this.provider === 'gemini') {
      return this.generateGemini(messages);
    } else {
      return this.generateOpenAI(messages);
    }
  }

  private async generateWithToolsOpenAI(
    messages: LLMMessage[],
    tools: ToolDefinition[]
  ): Promise<AsyncIterable<StreamChunk>> {
    const baseUrl = this.providerConfig.baseUrl || 'https://openrouter.ai/api/v1';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    if (this.provider === 'openrouter') {
      headers['HTTP-Referer'] = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
      headers['X-Title'] = 'OSW-Studio';
    }

    if (this.providerConfig.customHeaders) {
      Object.assign(headers, this.providerConfig.customHeaders);
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        messages,
        tools: tools.map(tool => ({
          type: 'function',
          function: tool
        })),
        tool_choice: 'auto',
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        stream: true
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.providerConfig.name} API error: ${error}`);
    }

    return this.parseStreamResponse(response);
  }

  private async generateOpenAI(messages: LLMMessage[]): Promise<string> {
    const baseUrl = this.providerConfig.baseUrl || 'https://openrouter.ai/api/v1';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    if (this.provider === 'openrouter') {
      headers['HTTP-Referer'] = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
      headers['X-Title'] = 'OSW-Studio';
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        stream: false
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.providerConfig.name} API error: ${error}`);
    }

    const data: OpenRouterResponse = await response.json();
    return data.choices[0]?.message?.content || '';
  }

  private async generateWithToolsAnthropic(
    messages: LLMMessage[],
    tools: ToolDefinition[]
  ): Promise<AsyncIterable<StreamChunk>> {
    const systemMessage = messages.find(m => m.role === 'system')?.content || '';
    const anthropicMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      }));

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'tools-2024-04-04'
      },
      body: JSON.stringify({
        model: this.model,
        messages: anthropicMessages,
        system: systemMessage,
        tools: tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters
        })),
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        stream: true
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${error}`);
    }

    return this.parseAnthropicStream(response);
  }

  private async generateAnthropic(messages: LLMMessage[]): Promise<string> {
    const systemMessage = messages.find(m => m.role === 'system')?.content || '';
    const anthropicMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      }));

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: this.model,
        messages: anthropicMessages,
        system: systemMessage,
        temperature: this.temperature,
        max_tokens: this.maxTokens
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${error}`);
    }

    const data = await response.json();
    return data.content[0]?.text || '';
  }

  private async generateWithToolsGemini(
    _messages: LLMMessage[],
    _tools: ToolDefinition[]
  ): Promise<AsyncIterable<StreamChunk>> {
    throw new Error('Gemini tool calling not yet implemented. Please use OpenRouter or another provider.');
  }

  private async generateGemini(messages: LLMMessage[]): Promise<string> {
    const contents = messages.map(m => ({
      role: m.role === 'system' ? 'user' : m.role,
      parts: [{ text: m.content }]
    }));

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: this.temperature,
            maxOutputTokens: this.maxTokens
          }
        })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${error}`);
    }

    const data = await response.json();
    return data.candidates[0]?.content?.parts[0]?.text || '';
  }

  private async *parseStreamResponse(response: Response): AsyncIterable<StreamChunk> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let currentToolCall: (Partial<ToolCall> & { argumentsBuffer?: string }) | null = null;
    let usageInfo: Partial<UsageInfo> | null = null;
    let generationId: string | null = null;

    if (this.provider === 'openrouter') {
      const headers = response.headers;
      
      // Capture generation ID for accurate cost tracking
      generationId = GenerationAPIService.extractGenerationId(headers);
      
      // Try to get cost info from headers first
      const headerCostInfo = GenerationAPIService.extractCostFromHeaders(headers);
      if (headerCostInfo?.cost !== undefined || headerCostInfo?.usage) {
        const promptTokens = headerCostInfo.usage?.prompt_tokens ?? 0;
        const completionTokens = headerCostInfo.usage?.completion_tokens ?? 0;
        const totalTokens = headerCostInfo.usage?.total_tokens ?? (promptTokens + completionTokens);
        const rawCost = headerCostInfo.cost ?? headerCostInfo.usage?.total_cost;
        const hasCost = typeof rawCost === 'number' && Number.isFinite(rawCost);
        const costIsMeaningful = hasCost && rawCost > 1e-6;

        usageInfo = {
          promptTokens,
          completionTokens,
          totalTokens,
          cost: costIsMeaningful ? rawCost : undefined,
          model: this.model,
          provider: this.provider,
          generationId: generationId || undefined,
          isEstimated: !costIsMeaningful
        };
      }
      
      // Fallback to old usage header parsing
      if (!usageInfo) {
        const usage = headers.get('x-openrouter-usage');
        if (usage) {
          try {
            const usageData = JSON.parse(usage);
            const rawCost = usageData.total_cost;
            const hasCost = typeof rawCost === 'number' && Number.isFinite(rawCost);
            const costIsMeaningful = hasCost && rawCost > 1e-6;
            usageInfo = {
              promptTokens: usageData.prompt_tokens || 0,
              completionTokens: usageData.completion_tokens || 0,
              totalTokens: usageData.total_tokens || ((usageData.prompt_tokens || 0) + (usageData.completion_tokens || 0)),
              cost: costIsMeaningful ? rawCost : undefined,
              model: this.model,
              provider: this.provider,
              generationId: generationId || undefined,
              isEstimated: !costIsMeaningful
            };
          } catch (error) {
            logger.error('Error parsing OpenRouter usage header:', error);
          }
        }
      }
    }

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
            if (usageInfo && usageInfo.totalTokens) {
              yield { type: 'usage', usage: usageInfo as UsageInfo };
            }
            yield { type: 'done' };
            return;
          }

          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta;

            if (delta?.content) {
              yield {
                type: 'content',
                content: delta.content
              };
            }

            if (delta?.tool_calls) {
              for (const toolCall of delta.tool_calls) {
                if (toolCall.id) {
                  if (currentToolCall) {
                    yield {
                      type: 'tool_call',
                      toolCall: currentToolCall as ToolCall
                    };
                  }
                  currentToolCall = {
                    id: toolCall.id,
                    type: 'function' as const,
                    function: {
                      name: toolCall.function?.name || '',
                      arguments: ''
                    }
                  };
                }

                if (toolCall.function?.arguments) {
                  if (currentToolCall) {
                    currentToolCall.argumentsBuffer = (currentToolCall.argumentsBuffer || '') + toolCall.function.arguments;
                    if (currentToolCall.function) {
                      currentToolCall.function.arguments = currentToolCall.argumentsBuffer;
                    }
                  }
                }
              }
            }

            if (json.usage) {
              usageInfo = {
                promptTokens: json.usage.prompt_tokens || 0,
                completionTokens: json.usage.completion_tokens || 0,
                totalTokens: json.usage.total_tokens || 0,
                cachedTokens: json.usage.cached_tokens,
                model: this.model,
                provider: this.provider,
                generationId: generationId || undefined
              };
            }

            if (json.x_groq?.usage) {
              usageInfo = {
                promptTokens: json.x_groq.usage.prompt_tokens || 0,
                completionTokens: json.x_groq.usage.completion_tokens || 0,
                totalTokens: json.x_groq.usage.total_tokens || 0,
                model: this.model,
                provider: this.provider
              };
            }
          } catch (error) {
            logger.error('Error parsing stream chunk:', error);
          }
        }
      }
    }

    if (currentToolCall) {
      try {
        const argBuffer = currentToolCall.argumentsBuffer;
        if (argBuffer && currentToolCall.function) {
          currentToolCall.function.arguments = argBuffer;
        }
        yield {
          type: 'tool_call',
          toolCall: currentToolCall as ToolCall
        };
      } catch (error) {
        logger.error('Error parsing tool call parameters:', error);
      }
    }
    
    if (usageInfo && usageInfo.totalTokens) {
      yield { type: 'usage', usage: usageInfo as UsageInfo };
    }
    
    yield { type: 'done' };
  }

  private async *parseAnthropicStream(response: Response): AsyncIterable<StreamChunk> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let usageInfo: Partial<UsageInfo> | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          try {
            const json = JSON.parse(data);
            
            if (json.type === 'content_block_delta' && json.delta?.text_delta?.text) {
              yield {
                type: 'content',
                content: json.delta.text_delta.text
              };
            } else if (json.type === 'content_block_start' && json.content_block?.type === 'tool_use') {
              yield {
                type: 'tool_call',
                toolCall: {
                  id: json.content_block.id,
                  type: 'function' as const,
                  function: {
                    name: json.content_block.name,
                    arguments: JSON.stringify(json.content_block.input || {})
                  }
                }
              };
            } else if (json.type === 'message_start' && json.message?.usage) {
              usageInfo = {
                promptTokens: json.message.usage.input_tokens || 0,
                completionTokens: json.message.usage.output_tokens || 0,
                totalTokens: (json.message.usage.input_tokens || 0) + (json.message.usage.output_tokens || 0),
                cachedTokens: json.message.usage.cache_creation_input_tokens || json.message.usage.cache_read_input_tokens,
                model: this.model,
                provider: this.provider
              };
            } else if (json.type === 'message_delta' && json.usage) {
              if (usageInfo) {
                usageInfo.completionTokens = json.usage.output_tokens || usageInfo.completionTokens;
                usageInfo.totalTokens = (usageInfo.promptTokens || 0) + (usageInfo.completionTokens || 0);
              }
            } else if (json.type === 'message_stop') {
                if (usageInfo && usageInfo.totalTokens) {
                yield { type: 'usage', usage: usageInfo as UsageInfo };
              }
              yield { type: 'done' };
              return;
            }
          } catch (error) {
            logger.error('Error parsing Anthropic stream:', error);
          }
        }
      }
    }
    
    if (usageInfo && usageInfo.totalTokens) {
      yield { type: 'usage', usage: usageInfo as UsageInfo };
    }
    
    yield { type: 'done' };
  }

  static async validateApiKey(apiKey: string, provider: ProviderId): Promise<boolean> {
    if (!apiKey) return false;
    
    try {
      const response = await fetch('/api/validate-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          apiKey,
          provider
        })
      });
      
      if (!response.ok) {
        return false;
      }
      
      const { valid } = await response.json();
      return valid;
    } catch {
      return false;
    }
  }

  static async getAvailableModels(apiKey?: string, provider?: ProviderId): Promise<string[]> {
    const currentProvider = provider || configManager.getSelectedProvider() || 'openrouter';
    const providerConfig = getProvider(currentProvider);
    const key = apiKey || configManager.getProviderApiKey(currentProvider);
    
    if (!providerConfig.supportsModelDiscovery && providerConfig.models) {
      return providerConfig.models.map(m => m.id);
    }

    try {
      const response = await fetch('/api/models', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          apiKey: key,
          provider: currentProvider
        })
      });
      
      if (!response.ok) {
        // Fall back to hardcoded models if available
        return providerConfig.models?.map(m => m.id) || [];
      }
      
      const { models } = await response.json();
      return models || [];
    } catch {
      // Fall back to hardcoded models if available
      return providerConfig.models?.map(m => m.id) || [];
    }
  }
}

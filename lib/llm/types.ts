export interface ToolParameter {
  type?: string;
  description?: string;
  enum?: string[];
  items?: {
    type: string;
    properties?: Record<string, ToolParameter>;
  };
  oneOf?: ToolParameter[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResult {
  success: boolean;
  message?: string;
  data?: unknown;
  error?: string;
}


export interface FileContext {
  projectId: string;
  fileTree?: string;
  currentFiles?: string[];
  openFile?: string;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface OpenRouterResponse {
  choices: Array<{
    message: {
      content?: string;
      tool_calls?: Array<{
        id: string;
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason?: string;
  }>;
}

export interface UsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number; // In USD, either from API or calculated
  cachedTokens?: number;
  reasoningTokens?: number;
  model?: string;
  provider?: string;
  generationId?: string; // OpenRouter generation ID for accurate cost tracking
  isEstimated?: boolean; // Flag to indicate if cost is estimated vs actual
}

export interface StreamChunk {
  type: 'content' | 'tool_call' | 'done' | 'usage';
  content?: string;
  toolCall?: ToolCall;
  usage?: UsageInfo;
}
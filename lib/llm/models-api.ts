import { logger } from '@/lib/utils';

export interface ModelArchitecture {
  input_modalities: string[];
  output_modalities: string[];
  tokenizer: string;
  instruct_type: string | null;
}

export interface ModelPricing {
  prompt: string;
  completion: string;
  request: string;
  image: string;
  web_search: string;
  internal_reasoning: string;
  input_cache_read: string;
  input_cache_write: string;
}

export interface TopProvider {
  context_length: number;
  max_completion_tokens: number;
  is_moderated: boolean;
}

export interface OpenRouterModel {
  id: string;
  canonical_slug: string;
  name: string;
  created: number;
  description: string;
  context_length: number;
  architecture: ModelArchitecture;
  pricing: ModelPricing;
  top_provider: TopProvider;
  per_request_limits: any | null;
  supported_parameters: string[];
}

export interface ModelsResponse {
  data: OpenRouterModel[];
}

export async function fetchAvailableModels(): Promise<OpenRouterModel[]> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models');
    
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.statusText}`);
    }
    
    const data: ModelsResponse = await response.json();
    
    const filteredModels = data.data.filter(model => 
      model.architecture.output_modalities.includes('text') &&
      model.supported_parameters.includes('tools')
    );
    
    return filteredModels.sort((a, b) => {
      const popularModels = ['gpt-4', 'claude', 'deepseek', 'qwen'];
      const aIsPopular = popularModels.some(p => a.id.toLowerCase().includes(p));
      const bIsPopular = popularModels.some(p => b.id.toLowerCase().includes(p));
      
      if (aIsPopular && !bIsPopular) return -1;
      if (!aIsPopular && bIsPopular) return 1;
      
      return b.created - a.created;
    });
  } catch (error) {
    logger.error('Error fetching models:', error);
    return getDefaultModels();
  }
}

/**
 * Format model price with appropriate precision
 * @param price Price per million tokens
 * @param perK If true, show price per 1K tokens (default), otherwise per 1M
 */
export function formatModelPrice(price: number | undefined, perK: boolean = true): string {
  if (price === undefined || price === null) return '';
  
  const displayPrice = perK ? price / 1000 : price;
  
  if (displayPrice === 0) return 'free';
  
  if (displayPrice < 0.0001) {
    return `$${displayPrice.toFixed(5).replace(/\.?0+$/, '')}`;
  } else if (displayPrice < 0.001) {
    return `$${displayPrice.toFixed(4).replace(/\.?0+$/, '')}`;
  } else if (displayPrice < 0.01) {
    return `$${displayPrice.toFixed(3).replace(/\.?0+$/, '')}`;
  } else if (displayPrice < 0.1) {
    return `$${displayPrice.toFixed(3).replace(/\.?0+$/, '')}`;
  } else if (displayPrice < 1) {
    return `$${displayPrice.toFixed(2).replace(/\.?0+$/, '')}`;
  } else {
    return `$${displayPrice.toFixed(2)}`;
  }
}

export function getDefaultModels(): OpenRouterModel[] {
  return [
    {
      id: 'deepseek/deepseek-chat',
      canonical_slug: 'deepseek-chat',
      name: 'DeepSeek Chat',
      created: Date.now(),
      description: 'DeepSeek Chat - Fast and capable model for general tasks',
      context_length: 64000,
      architecture: {
        input_modalities: ['text'],
        output_modalities: ['text'],
        tokenizer: 'cl100k_base',
        instruct_type: 'deepseek'
      },
      pricing: {
        prompt: '0.00014',
        completion: '0.00028',
        request: '0',
        image: '0',
        web_search: '0',
        internal_reasoning: '0',
        input_cache_read: '0',
        input_cache_write: '0'
      },
      top_provider: {
        context_length: 64000,
        max_completion_tokens: 8192,
        is_moderated: false
      },
      per_request_limits: null,
      supported_parameters: ['tools', 'tool_choice', 'temperature', 'max_tokens']
    },
    {
      id: 'qwen/qwen-2.5-coder-32b-instruct',
      canonical_slug: 'qwen-2.5-coder-32b-instruct',
      name: 'Qwen 2.5 Coder 32B',
      created: Date.now(),
      description: 'Qwen 2.5 Coder - Specialized for code generation',
      context_length: 32768,
      architecture: {
        input_modalities: ['text'],
        output_modalities: ['text'],
        tokenizer: 'cl100k_base',
        instruct_type: 'qwen'
      },
      pricing: {
        prompt: '0.00018',
        completion: '0.00018',
        request: '0',
        image: '0',
        web_search: '0',
        internal_reasoning: '0',
        input_cache_read: '0',
        input_cache_write: '0'
      },
      top_provider: {
        context_length: 32768,
        max_completion_tokens: 8192,
        is_moderated: false
      },
      per_request_limits: null,
      supported_parameters: ['tools', 'tool_choice', 'temperature', 'max_tokens']
    },
    {
      id: 'openai/gpt-4o',
      canonical_slug: 'gpt-4o',
      name: 'GPT-4o',
      created: Date.now(),
      description: 'OpenAI GPT-4o - Multimodal model with vision capabilities',
      context_length: 128000,
      architecture: {
        input_modalities: ['text', 'image'],
        output_modalities: ['text'],
        tokenizer: 'cl100k_base',
        instruct_type: 'openai'
      },
      pricing: {
        prompt: '0.0025',
        completion: '0.01',
        request: '0',
        image: '0.00765',
        web_search: '0',
        internal_reasoning: '0',
        input_cache_read: '0.00125',
        input_cache_write: '0.0025'
      },
      top_provider: {
        context_length: 128000,
        max_completion_tokens: 16384,
        is_moderated: true
      },
      per_request_limits: null,
      supported_parameters: ['tools', 'tool_choice', 'temperature', 'max_tokens', 'response_format']
    },
    {
      id: 'anthropic/claude-3.5-sonnet',
      canonical_slug: 'claude-3.5-sonnet',
      name: 'Claude 3.5 Sonnet',
      created: Date.now(),
      description: 'Anthropic Claude 3.5 Sonnet - Advanced reasoning and coding',
      context_length: 200000,
      architecture: {
        input_modalities: ['text', 'image'],
        output_modalities: ['text'],
        tokenizer: 'claude',
        instruct_type: 'anthropic'
      },
      pricing: {
        prompt: '0.003',
        completion: '0.015',
        request: '0',
        image: '0.0048',
        web_search: '0',
        internal_reasoning: '0',
        input_cache_read: '0.0003',
        input_cache_write: '0.00375'
      },
      top_provider: {
        context_length: 200000,
        max_completion_tokens: 8192,
        is_moderated: false
      },
      per_request_limits: null,
      supported_parameters: ['tools', 'tool_choice', 'temperature', 'max_tokens']
    }
  ];
}


export function getModelDisplayName(model: OpenRouterModel): string {
  if (model.name.length > 30) {
    const parts = model.id.split('/');
    const provider = parts[0];
    const modelName = parts[1];
    
    const versionMatch = modelName.match(/(\d+[\.\d]*)/);
    const version = versionMatch ? versionMatch[1] : '';
    
    if (provider === 'openai') {
      if (modelName.includes('gpt-4o')) return 'GPT-4o';
      if (modelName.includes('gpt-4')) return `GPT-4${version ? ` ${version}` : ''}`;
      if (modelName.includes('gpt-3.5')) return 'GPT-3.5 Turbo';
    }
    if (provider === 'anthropic') {
      if (modelName.includes('claude-3.5-sonnet')) return 'Claude 3.5 Sonnet';
      if (modelName.includes('claude-3.5-haiku')) return 'Claude 3.5 Haiku';
      if (modelName.includes('claude-3-opus')) return 'Claude 3 Opus';
    }
    if (provider === 'deepseek') {
      if (modelName.includes('chat')) return 'DeepSeek Chat';
      if (modelName.includes('coder')) return `DeepSeek Coder${version ? ` ${version}` : ''}`;
      if (modelName.includes('reasoner')) return 'DeepSeek Reasoner';
    }
    if (provider === 'qwen' && modelName.includes('coder')) {
      const sizeMatch = modelName.match(/(\d+b)/i);
      const size = sizeMatch ? ` ${sizeMatch[1].toUpperCase()}` : '';
      return `Qwen Coder${size}`;
    }
  }
  
  return model.name;
}
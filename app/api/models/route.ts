import { NextRequest, NextResponse } from 'next/server';
import { ProviderId } from '@/lib/llm/providers/types';
import { getProvider } from '@/lib/llm/providers/registry';
import { logger } from '@/lib/utils';

export async function POST(request: NextRequest) {
  try {
    const { apiKey, provider } = await request.json();
    
    if (!provider) {
      return NextResponse.json(
        { error: 'Provider is required' },
        { status: 400 }
      );
    }

    const providerConfig = getProvider(provider as ProviderId);
    
    // If no API key but required, return empty array
    if (providerConfig.apiKeyRequired && !apiKey) {
      return NextResponse.json({ models: [] });
    }

    let models: string[] = [];

    try {
      switch (provider) {
        case 'openrouter':
          const orResponse = await fetch('https://openrouter.ai/api/v1/models', {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'HTTP-Referer': request.headers.get('referer') || 'http://localhost:3000',
              'X-Title': 'OSW-Studio'
            }
          });
          if (orResponse.ok) {
            const orData = await orResponse.json();
            models = orData.data
              ?.filter((model: { id: string }) => 
                model.id.includes('deepseek') || 
                model.id.includes('qwen') || 
                model.id.includes('claude') ||
                model.id.includes('gpt') ||
                model.id.includes('llama')
              )
              ?.map((model: { id: string }) => model.id) || [];
          }
          break;

        case 'anthropic':
          const anthropicResponse = await fetch('https://api.anthropic.com/v1/models', {
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01'
            }
          });
          if (anthropicResponse.ok) {
            const anthropicData = await anthropicResponse.json();
            models = anthropicData.data?.map((model: { id: string }) => model.id) || [];
          }
          break;

        case 'openai':
          const openaiResponse = await fetch('https://api.openai.com/v1/models', {
            headers: {
              'Authorization': `Bearer ${apiKey}`
            }
          });
          if (openaiResponse.ok) {
            const openaiData = await openaiResponse.json();
            models = openaiData.data?.map((model: { id: string }) => model.id) || [];
          }
          break;

        case 'groq':
          const groqResponse = await fetch('https://api.groq.com/openai/v1/models', {
            headers: {
              'Authorization': `Bearer ${apiKey}`
            }
          });
          if (groqResponse.ok) {
            const groqData = await groqResponse.json();
            models = groqData.data?.map((model: { id: string }) => model.id) || [];
          }
          break;

        case 'ollama':
          try {
            // Use Ollama's native API endpoint for model discovery
            const ollamaResponse = await fetch(`http://localhost:11434/api/tags`);
            if (ollamaResponse.ok) {
              const ollamaData = await ollamaResponse.json();
              // Ollama returns models array directly in the response
              models = ollamaData.models?.map((m: any) => m.name) || [];
            }
          } catch (error) {
            logger.error('Ollama models fetch error:', error);
          }
          break;

        case 'lmstudio':
          try {
            const lmResponse = await fetch(`${providerConfig.baseUrl}/models`);
            if (lmResponse.ok) {
              const lmData = await lmResponse.json();
              // LM Studio uses OpenAI-compatible format with data array
              models = lmData.data?.map((m: any) => m.id) || [];
            }
          } catch (error) {
            logger.error('LM Studio models fetch error:', error);
          }
          break;

        case 'gemini':
          // Gemini uses hardcoded models from config
          models = providerConfig.models?.map(m => m.id) || [];
          break;

        default:
          // For other OpenAI-compatible providers
          if (providerConfig.baseUrl && apiKey) {
            const defaultResponse = await fetch(`${providerConfig.baseUrl}/models`, {
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
              }
            });
            if (defaultResponse.ok) {
              const defaultData = await defaultResponse.json();
              models = defaultData.data?.map((m: any) => m.id) || [];
            }
          }
          break;
      }
    } catch (error) {
      logger.error(`Error fetching models for ${provider}:`, error);
      // Fall back to hardcoded models if available
      if (providerConfig.models) {
        models = providerConfig.models.map(m => m.id);
      }
    }

    return NextResponse.json({ models });

  } catch (error) {
    logger.error('Models API error:', error);
    return NextResponse.json({ models: [] });
  }
}

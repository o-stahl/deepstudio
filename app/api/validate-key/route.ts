import { NextRequest, NextResponse } from 'next/server';
import { ProviderId } from '@/lib/llm/providers/types';
import { getProvider } from '@/lib/llm/providers/registry';
import { logger } from '@/lib/utils';

export async function POST(request: NextRequest) {
  try {
    const { apiKey, provider } = await request.json();
    
    if (!apiKey || !provider) {
      return NextResponse.json(
        { error: 'API key and provider are required' },
        { status: 400 }
      );
    }

    const providerConfig = getProvider(provider as ProviderId);
    let isValid = false;

    switch (provider) {
      case 'openrouter':
        const openrouterResp = await fetch('https://openrouter.ai/api/v1/auth/key', {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        isValid = openrouterResp.ok;
        break;

      case 'openai':
        const openaiResp = await fetch('https://api.openai.com/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        isValid = openaiResp.ok;
        break;

      case 'anthropic':
        const anthropicResp = await fetch('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          }
        });
        isValid = anthropicResp.ok;
        break;

      case 'groq':
        const groqResp = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        isValid = groqResp.ok;
        break;

      case 'ollama':
      case 'lmstudio':
        const localResp = await fetch(`${providerConfig.baseUrl}/models`);
        isValid = localResp.ok;
        break;

      case 'gemini':
        isValid = !!apiKey && apiKey.length > 10;
        break;

      default:
        // For other OpenAI-compatible providers
        if (providerConfig.baseUrl) {
          const defaultResp = await fetch(`${providerConfig.baseUrl}/models`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
          });
          isValid = defaultResp.ok;
        } else {
          isValid = false;
        }
        break;
    }

    return NextResponse.json({ valid: isValid });

  } catch (error) {
    logger.error('Validation error:', error);
    return NextResponse.json({ valid: false });
  }
}

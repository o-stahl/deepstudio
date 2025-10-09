import { NextRequest, NextResponse } from 'next/server';
import { ProviderId } from '@/lib/llm/providers/types';
import { getProvider } from '@/lib/llm/providers/registry';
import { LLMMessage, ToolDefinition } from '@/lib/llm/types';

export async function POST(request: NextRequest) {
  try {
    const { prompt, apiKey, model, tools, context, messages, tool_choice, provider, max_tokens } = await request.json();
    
    const selectedProvider: ProviderId = provider || 'openrouter';
    const providerConfig = getProvider(selectedProvider);
    
    if (!prompt && !messages) {
      return NextResponse.json(
        { error: 'Either prompt or messages is required' },
        { status: 400 }
      );
    }

    if (providerConfig.apiKeyRequired && !apiKey) {
      return NextResponse.json(
        { error: `${providerConfig.name} API key is required. Please set it in settings.` },
        { status: 400 }
      );
    }

    let systemPrompt = `You operate in a sandboxed virtual terminal.

Guidelines:
- Create semantic, accessible HTML5; modern CSS3; clean JS (ES6+).
- Use relative paths; keep structure simple; prefer early returns.

Capabilities:
- Two tools: shell({ cmd: string[] }) for commands, json_patch for file editing.
- Edit files reliably with json_patch tool:
  Use EXACT string replacement - copy text precisely from file as seen with cat.
  oldStr must be unique; JSON escaping handled automatically.
- Supported shell commands: ls, cat, nl [-ba], grep (-n -i), find (-name), mkdir -p, rm [-rfv], rmdir [-v], mv, cp [-r], echo (stdout only; no redirection), sed s/pat/repl/g (non-persisting).
- No network; only /workspace paths exist.
  • Note: both '/path' and '/workspace/path' are accepted; '/workspace' is normalized to '/'.

Habits:
- Read with ls/cat/grep/find before editing.
- Persist file content changes ONLY with json_patch tool; use mv/rm/mkdir/cp for structure.
- Do NOT use echo > or >> or sed to write files; redirection is disabled by design.
- Use json_patch operations in priority order:
  1. PREFER "replace_entity" for HTML elements, functions, components (more reliable)
  2. Use "update" only for simple text changes without clear entity boundaries  
  3. Use "rewrite" for complete file replacement
- AVOID large oldStr blocks (50+ lines) - use replace_entity instead for code blocks.
- Keep changes small and atomic.`;

    if (context?.fileTree) {
      systemPrompt += `\n\nCurrent project structure:\n${context.fileTree}`;
    }

    if (context?.existingFiles && Array.isArray(context.existingFiles)) {
      systemPrompt += `\n\nExisting files (modify via json_patch; use mv/rm for structure):\n${context.existingFiles.join('\n')}`;
    }

    if (context?.mainFiles && Object.keys(context.mainFiles).length > 0) {
      systemPrompt += `\n\nCurrent file contents (use exact text when crafting json_patch operations):`;
      for (const [path, content] of Object.entries(context.mainFiles)) {
        const contentStr = String(content);
        const truncatedContent = contentStr.length > 1000 ? contentStr.substring(0, 1000) + '\n... (truncated)' : contentStr;
        systemPrompt += `\n\n=== ${path} ===\n${truncatedContent}`;
      }
    }

    if (context?.instructions) {
      systemPrompt += `\n\nAdditional instructions:\n${context.instructions}`;
    }

    const chatMessages = messages || [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ];
    
    if (messages && !messages.some((m: LLMMessage) => m.role === 'system')) {
      chatMessages.unshift({ role: 'system', content: systemPrompt });
    }

    const apiEndpoint = getApiEndpoint(selectedProvider, providerConfig, model);
    const headers = buildHeaders(selectedProvider, apiKey, request, providerConfig);
    
    let processedMessages = chatMessages;
    let anthropicSystemPrompt = '';
    
    if (selectedProvider === 'anthropic') {
      const systemMessage = chatMessages.find((msg: LLMMessage) => msg.role === 'system');
      if (systemMessage) {
        anthropicSystemPrompt = systemMessage.content;
      }
      
      processedMessages = [];
      let currentUserMessage: any = null;
      
      for (const msg of chatMessages) {
        if (msg.role === 'system') {
          continue;
        } else if (msg.role === 'tool') {
          if (currentUserMessage && currentUserMessage.role === 'user') {
            if (!Array.isArray(currentUserMessage.content)) {
              currentUserMessage = {
                ...currentUserMessage,
                content: [{ type: 'text', text: currentUserMessage.content }]
              };
            }
            currentUserMessage.content.push({
              type: 'tool_result',
              tool_use_id: msg.tool_call_id,
              content: msg.content
            });
          } else {
            if (currentUserMessage && currentUserMessage.role === 'user') {
              processedMessages.push(currentUserMessage);
            }
            currentUserMessage = {
              role: 'user',
              content: [{
                type: 'tool_result',
                tool_use_id: msg.tool_call_id,
                content: msg.content
              }]
            };
          }
        } else {
          if (currentUserMessage && currentUserMessage.role === 'user') {
            processedMessages.push(currentUserMessage);
          }
          
          if (msg.role === 'assistant' && msg.tool_calls) {
            const content = [];
            if (msg.content) {
              content.push({ type: 'text', text: msg.content });
            }
            for (const toolCall of msg.tool_calls) {
              content.push({
                type: 'tool_use',
                id: toolCall.id,
                name: toolCall.function.name,
                input: JSON.parse(toolCall.function.arguments || '{}')
              });
            }

            currentUserMessage = {
              role: 'assistant',
              content: content
            };
          } else {
            // Ensure non-empty content for Anthropic
            const messageContent = msg.content || '';
            if (!messageContent && msg.role === 'assistant') {
              // Skip empty assistant messages (Anthropic rejects them)
              currentUserMessage = null;
            } else {
              currentUserMessage = { ...msg };
            }
          }
          
          if (msg.role !== 'user' && currentUserMessage) {
            processedMessages.push(currentUserMessage);
            currentUserMessage = null;
          }
        }
      }
      
      if (currentUserMessage && currentUserMessage.role === 'user') {
        processedMessages.push(currentUserMessage);
      }
    }

    const requestBody: Record<string, unknown> = {
      model: model || getDefaultModel(selectedProvider),
      messages: processedMessages,
      stream: true
    };

    if (selectedProvider === 'anthropic' && anthropicSystemPrompt) {
      requestBody.system = anthropicSystemPrompt;
    }

    if (tools && tools.length > 0) {
      // Validate tools to ensure all required fields are present
      const validTools = tools.filter((tool: { name?: string; description?: string; parameters?: unknown }) => {
        if (!tool.name || tool.name.trim() === '') {
          console.error('[API] Tool missing required "name" field:', tool);
          return false;
        }
        if (!tool.description) {
          console.warn('[API] Tool missing "description" field:', tool.name);
        }
        if (!tool.parameters) {
          console.warn('[API] Tool missing "parameters" field:', tool.name);
        }
        return true;
      });

      if (validTools.length === 0) {
        return NextResponse.json(
          { error: 'All tools are invalid. Tools must have a name field.' },
          { status: 400 }
        );
      }

      if (selectedProvider === 'anthropic') {
        requestBody.tools = validTools.map((tool: { name: string; description: string; parameters: unknown }) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters
        }));
        if (tool_choice && typeof tool_choice === 'object') {
          requestBody.tool_choice = tool_choice;
        } else if (tool_choice === 'auto' || !tool_choice) {
          requestBody.tool_choice = { type: 'auto' };
        } else if (tool_choice === 'any') {
          requestBody.tool_choice = { type: 'any' };
        } else if (typeof tool_choice === 'string') {
          requestBody.tool_choice = { type: 'tool', name: tool_choice };
        } else {
          requestBody.tool_choice = { type: 'auto' };
        }
      } else if (selectedProvider === 'ollama') {
        requestBody.tools = validTools.map((tool: { name: string; description: string; parameters: unknown }) => ({
          type: 'function',
          function: tool
        }));
        requestBody.tool_choice = tool_choice || 'auto';
      } else {
        requestBody.tools = validTools.map((tool: { name: string; description: string; parameters: unknown }) => ({
          type: 'function',
          function: tool
        }));
        requestBody.tool_choice = tool_choice || 'auto';
      }
    }

    if (selectedProvider === 'openai') {
      requestBody.max_completion_tokens = max_tokens || 4096;
      
      const modelName = model || getDefaultModel(selectedProvider);
      if (modelName.includes('gpt-5-nano')) {
        requestBody.temperature = 1;
      } else {
        requestBody.temperature = 0.7;
      }
    } else if (selectedProvider === 'anthropic') {
      requestBody.max_tokens = max_tokens || 4096;
      requestBody.temperature = 0.7;
    } else {
      requestBody.max_tokens = max_tokens || 4096;
      requestBody.temperature = 0.7;
    }


    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();

      // Try to parse and extract clean error message from JSON response
      let cleanError = errorText;
      try {
        const parsed = JSON.parse(errorText);
        if (parsed.error?.message) {
          // Extract the inner message: "Key limit exceeded. Manage it using..."
          cleanError = parsed.error.message;
        } else if (typeof parsed.error === 'string') {
          cleanError = parsed.error;
        }
      } catch {
        // Not JSON, use raw text as-is
      }

      const headers: Record<string, string> = {};
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const rateLimitReset = response.headers.get('X-RateLimit-Reset');
        const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');

        if (retryAfter) headers['Retry-After'] = retryAfter;
        if (rateLimitReset) headers['X-RateLimit-Reset'] = rateLimitReset;
        if (rateLimitRemaining) headers['X-RateLimit-Remaining'] = rateLimitRemaining;
      }
      if (selectedProvider === 'ollama' && cleanError.includes('does not support tools') && tools && tools.length > 0) {
        const fallbackSystemPrompt = systemPrompt + `

IMPORTANT: This model doesn't support native function calling, so you must use JSON format for tool calls.

Available tools:
${tools.map((tool: ToolDefinition) => `
- ${tool.name}: ${tool.description}
  Parameters: ${JSON.stringify(tool.parameters, null, 2)}
`).join('')}

When you need to use a tool, respond with:
\`\`\`json
{
  "tool_calls": [
    {
      "id": "call_1",
      "function": {
        "name": "tool_name",
        "arguments": "{\"param1\": \"value1\"}"
      }
    }
  ]
}
\`\`\`

You can make multiple tool calls in a single response. Always include the tool_calls array even for a single tool call.`;

        const fallbackMessages = [...chatMessages];
        const systemMsgIndex = fallbackMessages.findIndex(m => m.role === 'system');
        if (systemMsgIndex >= 0) {
          fallbackMessages[systemMsgIndex].content = fallbackSystemPrompt;
        }

        const fallbackBody: any = {
          ...requestBody,
          messages: fallbackMessages
        };
        delete fallbackBody.tools;
        delete fallbackBody.tool_choice;

        const fallbackResponse = await fetch(apiEndpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(fallbackBody)
        });

        if (!fallbackResponse.ok) {
          const fallbackError = await fallbackResponse.text();
          return NextResponse.json(
            { error: `${providerConfig.name} API error (after fallback): ${fallbackError}` },
            { status: fallbackResponse.status }
          );
        }

        const fallbackHeaders: Record<string, string> = {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Tool-Fallback': 'json-parsing'
        };


        return new Response(fallbackResponse.body, {
          headers: fallbackHeaders,
        });
      }


      return NextResponse.json(
        { error: `${providerConfig.name} API error: ${cleanError}` },
        { status: response.status, headers }
      );
    }

    const responseHeaders: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    };

    if (selectedProvider === 'openrouter') {
      const openRouterHeaders = [
        'x-openrouter-generation-id',
        'x-openrouter-usage',
        'x-openrouter-tokens',
        'x-openrouter-cost'
      ];
      
      for (const headerName of openRouterHeaders) {
        const value = response.headers.get(headerName);
        if (value) {
          responseHeaders[headerName] = value;
        }
      }
    }

    return new Response(response.body, {
      headers: responseHeaders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const isNetwork = /fetch failed|Failed to fetch|NetworkError/i.test(message);
    const friendly = isNetwork
      ? 'Network error: unable to reach the model API. Check your internet connection or proxy settings.'
      : message;
    return NextResponse.json(
      { error: friendly },
      { status: isNetwork ? 503 : 500 }
    );
  }
}

function getApiEndpoint(provider: ProviderId, config: ReturnType<typeof getProvider>, model?: string): string {
  const baseUrl = config.baseUrl || 'https://openrouter.ai/api/v1';
  
  if (provider === 'anthropic') {
    return 'https://api.anthropic.com/v1/messages';
  } else if (provider === 'gemini') {
    const geminiModel = model || 'gemini-1.5-flash';
    return `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`;
  } else {
    return `${baseUrl}/chat/completions`;
  }
}

function buildHeaders(
  provider: ProviderId, 
  apiKey: string | undefined,
  request: NextRequest,
  config: ReturnType<typeof getProvider>
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  
  if (provider === 'anthropic') {
    headers['x-api-key'] = apiKey || '';
    headers['anthropic-version'] = '2023-06-01';
    if (config.supportsFunctions) {
      headers['anthropic-beta'] = 'tools-2024-04-04';
    }
  } else if (provider === 'gemini') {
  } else {
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    
    if (provider === 'openrouter') {
      headers['HTTP-Referer'] = request.headers.get('referer') || 'http://localhost:3000';
      headers['X-Title'] = 'OSW-Studio';
    }
  }
  
  return headers;
}

function getDefaultModel(provider: ProviderId): string {
  switch (provider) {
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
      return 'deepseek/deepseek-chat';
  }
}

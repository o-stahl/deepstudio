# DeepStudio

**Agentic Browser-based Website Builder** (v1.0.4)

**Links**: [GitHub Repository](https://github.com/o-stahl/deepstudio) | [Live Demo](https://huggingface.co/spaces/otst/deepstudio) | [Changelog](./CHANGELOG.md)

DeepStudio is a fork from @enzostvs' DeepSite v2 that over the months of tinkering became a BYOK (Bring Your Own Key) agentic browser-based website builder where you describe what you want and an agent writes the code.

This is a solo project and there isn't a huge corporation behind it. 
I'll do my best to fix issues and possibly keep the project improving, but it's just a me doing this for fun so please be patient. All feedback and contributions are more than welcome.

If you make something with the app I would be thrilled if you could share what you've made. 

**Note**: DeepStudio builds static web sites/applications (HTML/CSS/JS). It's for prototyping front-end apps, demos, and landing pages, not for running backend code (Python, Node.js, etc.).

## Key Features

- **Agentic coding**: Agent autonomously handles file operations, edits code, and manages project structure
- **Multi-provider AI**: Works with Ollama, LM Studio, OpenRouter (200+ models), OpenAI, Anthropic Claude, Google Gemini, Groq, and SambaNova
- **Development environment**: Monaco editor with multi-tab support, live preview with hot reload, file explorer
- **Browser storage**: Everything stays in IndexedDB - no backend required
- **Export**: Download as ZIP and deploy to any static host (Vercel, Netlify, GitHub Pages)
- **Project management**: Create, duplicate, rename, and manage multiple projects
- **Checkpoints & Saving**: Rollback to previous states during session with per-message restore buttons and save when happy with progress
- **Session recovery**: Conversation and project state persists across refreshes
- **Responsive layout**: Works on desktop and mobile devices

## Getting Started

1. **Get API Key**: Sign up for or spin up any supported provider
2. **Open DeepStudio**: Open the app in your browser
3. **Select Provider**: Choose from 8 LLM providers in settings
4. **Enter API Key**: Add your provider's API key
5. **Create Project**: Start with demo or create new
6. **Describe Your App**: Use natural language prompts
7. **Export & Deploy**: Download ZIP and deploy anywhere

## Model Guidance

### Recommended Models that should give a good experience
- **Kimi K2** - Good balance of speed and quality
- **GLM4.5 and air** - Fast and reliable
- **gpt-oss-120b and 20b** - Strong reasoning capabilities
- **Qwen3 series** - Excellent for code generation
- **DeepSeek v3.1 or R1** - Great for complex tasks
- **SOTA models from**: Google, OpenAI (gpt-5-mini and nano), Grok, Meta, Anthropic (Haiku works reasonably well)

### Models Without Tool Calling Support that should still work with JSON parsing
- DeepSeek V3
- Qwen2.5 series
- Gemma3
- Mistral-small
- Granite 3.x
- Llama4 Maverick and Scout

**Bottom line**: A 4B tool model probably beats a 70B non-tool model for this use case, still models released post summer 2025 should work.

## File Support

| Type | Formats | Limits |
|------|---------|--------|
| **Code** | HTML, CSS, JS/JSX, JSON, HBS/Handlebars | 5MB text files |
| **Docs** | TXT, MD, XML, SVG | 5MB text files |
| **Media** | PNG, JPG, GIF, WebP, MP4, WebM | 10MB images, 50MB video |

## Supported Providers

**Local** (no API key required, but supported):
- Ollama
- LM Studio

**Cloud**:
- OpenRouter (200+ models)
- OpenAI
- Anthropic
- Google Gemini
- Groq
- SambaNova

## Tech Stack

- **Framework**: Next.js 15.3, React 19, TypeScript
- **UI**: TailwindCSS v4, Radix UI, Monaco Editor
- **Storage**: IndexedDB (client-side)
- **AI**: 8 LLM provider support

## How It Works

The agent interacts with the project through `shell` and `json_patch` tools operating on a virtual file system in your browser. The limited number of tools was a conscious choice to reduce the number of tools to reduce "tool stuffing" while leaning on the strong sh/bash capabilities of most modern models:

- **VFS commands**: The agent uses CLI commands (`ls`, `cat`, `grep`, `mkdir`, `rm`, `mv`, `cp`) on the in-browser file system
- **File editing**: Changes are applied through `json_patch` with precise string operations
- **Command validation**: Commands are validated before execution
- **Checkpoints**: State is saved after each operation for rollback
- **Rate limiting**: Automatic retry with exponential backoff

You describe what you want in natural language, and the agent handles the implementation.

## Local Development

```bash
# Clone repository
git clone https://github.com/o-stahl/deepstudio.git
cd deepstudio

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Provider Setup

1. Click settings in chat input
2. Select provider & enter API key
3. Choose model & start generating

**Get API Keys**: 
- [OpenRouter](https://openrouter.ai)
- [OpenAI](https://platform.openai.com)
- [Anthropic](https://console.anthropic.com)
- [Google](https://aistudio.google.com)

## Security

- **API keys**: Stored in browser `localStorage` per provider
- **Network calls**: Direct client calls or via proxy endpoints (`/api/generate`, `/api/models`, `/api/validate-key`)
- **Data storage**: Projects and checkpoints in browser IndexedDB

## Debugging

### Environment Variables

Set in `.env.local`:

```bash
# Log level: error, warn, info, debug (default: warn)
NEXT_PUBLIC_LOG_LEVEL=warn

# Tool streaming debug (default: 0)
NEXT_PUBLIC_DEBUG_TOOL_STREAM=0
```

### Troubleshooting

- **Generation fails**: Check DevTools console (F12)
- **Model compatibility**: Use Model Tester at `/test-generation`
- **Tool issues**: Enable `DEBUG_TOOL_STREAM=1`
- **Rate limits**: Watch for toast notifications
- **Local providers**: Ensure servers are running

## Limitations

- **Static apps only**: No Python, Node.js, or backend runtimes
- **No package manager**: Use CDN links for libraries
- **Deployment scope**: Optimized for static hosting

## Architecture

- `/components/` - React components for IDE interface
- `/lib/vfs/` - Virtual file system with checkpoints
- `/lib/llm/` - AI orchestration with shell tool interface
- `/app/api/` - Optional proxy routes for providers

## Privacy Note

Remote LLM providers (OpenAI, Anthropic, etc.) will receive your code when generating. For complete privacy, use local models with Ollama or LM Studio.

## Support

If you'd like to support the project or got some use out of it, [☕ buy me a coffee](https://buymeacoffee.com/otst) would be much appreciated.

## License

MIT License - See LICENSE file

## Credits

The project is not affiliated with @enzostvs, @victor or Hugging Face, but a big thanks to all for making the original project! Big thanks goes to Google as well for Google AI Studio (App Builder) as it was a significant inspiration for the project (and for their countless other open source contributions). OpenAI's Codex CLI helped with figuring out some of the agentic things while Anthropic's artifact/string patch based implementation was crucial for getting file edits to work reliably. More could and should be thanked so kudos to everyone contributing to open source software. 
# Changelog

## v1.13.0 - 2025-10-15
- Added Templates system for creating, managing, and sharing reusable project templates
- Export any project as a template (.oswt file) with customizable metadata (name, description, author, version, tags, license)
- Import templates to quickly start new projects
- Template browser with grid/list views, search, and sorting by name, author, or file count
- Project cards now display preview screenshots automatically captured from live preview
- Redesigned project list view with improved 3-column desktop layout
- Added pill-toggle navigation between Projects and Templates pages

## v1.12.0 - 2025-10-04
- Switch between read-only exploration (Chat) and full coding mode (Code)
- Chat mode: Read-only commands for codebase exploration and planning
- Code mode: Full file modification capabilities with json_patch and evaluation tools
- Write commands (touch, echo >, mkdir, rm, mv, cp) blocked in chat mode with helpful error messages
- Optional separate model selection per mode for cost optimization (e.g., use cheaper models for chat/planning)
- Mode state persists across sessions
- Renamed from DeepStudio to Open Source Web Studio (OSW Studio)
- Updated all UI text, database names, storage keys, and API headers
- Maintained full backward compatibility with DeepStudio .osws backup files
- Integrated new OSW Studio logo with theme-aware SVG (automatic light/dark mode support)
- Added outlined favicon design for visibility on all backgrounds
- Established brand naming convention: "Open Source Web Studio" (full), "OSW Studio" (short)
- Consolidated IndexedDB architecture from 3 separate databases to 1 unified database
- Atomic transactions now possible across all data types (projects, files, conversations, checkpoints)
- Improved import/export performance with single database connection
- Fixed backup import hanging issues with proper timeout handling and blocked connection detection
- Added DeepStudio → OSW Studio migration support via backup import
- Enhanced error handling and logging for all database operations
- Enhanced error handling: API errors now show toast notifications and remove thinking indicator
- Error messages persist in chat history with visual styling for easy troubleshooting
- Mobile save button indicator in workspace header appears when unsaved changes exist
- Added "Thinking..." indicator for LLM response wait times
- Early tool call visibility with streaming parameter updates
- Fixed chat auto-scroll during streaming (instant scroll instead of competing animations)
- Fixed preview button flashing during streaming (memoized component and callbacks)
- Subtle retry notifications
- Fixed double JSON encoding in API error responses for cleaner error messages
- Fixed 'echo' and 'touch' commands missing from structural commands for file explorer refresh
- Fixed evaluation tool showing premature status
- Fixed project name input validation
- Fixed metadata URLs (oswstudio → osw-studio) in layout and CLAUDE.md
- Added finish_reason handling for OpenRouter streaming
- Request evaluation when tool calls stop instead of blind retries
- Added runtime validation for tool definitions to prevent malformed tools
- Added loop detection: prevents LLM from repeating the same failing command consecutively
- Added progressive Handlebars rendering: missing partials show inline error stubs instead of failing entire page
- Codebase cleanup: removed 8 unused files and 9 unused dependencies
- Removed tw-animate-css dependency (Tailwind v4 includes built-in animations)
- Removed DeepStudio logo files (deepstudio-logo-dark.svg, app/favicon.ico)
- Updated demo template and GitHub repository links
- Updated theme storage and cost settings event naming

## v1.11.0 - 2025-02-03
- Enhanced evaluation tool with goal-oriented progress tracking (progress_summary, remaining_work, blockers)
- Improved orchestrator loop to properly enforce evaluation after meaningful work (3+ steps)
- Fixed evaluation state handling: now correctly respects should_continue flag
- Added comprehensive error messages with examples for all tool call failures
- Unified error message format across shell, json_patch, and evaluation tools
- Added file creation guidelines to system prompt for cleaner project structure

## v1.10.0 - 2025-02-02
- Added token-efficient shell commands: `rg` (ripgrep), `head`, `tail`, `tree`, `touch`, and `echo >` redirection
- Removed redundant commands: `sed`, `nl`, `rmdir`
- Enhanced system prompt to discourage `cat` usage with decision flowchart and token cost warnings

## v1.9.1 - 2025-01-30
- Fixed Handlebars navigation links being converted to blob URLs instead of remaining as routes

## v1.9.0 - 2025-01-29
- Added complete data backup and restore functionality
- Export all projects, conversations, and checkpoints to .dstudio file
- Import data with merge or replace options
- Fixed changelog versioning to follow semantic versioning (major.minor.patch)

## v1.8.0 - 2025-01-28
- Enhanced system prompt with directory tree structure and file sizes
- Major VFS improvements: Added comprehensive image loading interceptor for dynamic content
- VFS now transparently handles JavaScript-generated images and assets via blob URLs
- Fixed image resolution issues in templates with automatic innerHTML processing
- Refactored template system with self-contained asset definitions
- Unified createProjectFromTemplate function with optional assets parameter

## v1.7.0 - 2025-01-27
- Modularized the monolithic template file
- Removed Handlebars template
- Added step counter to guided tour overlay

## v1.6.0 - 2025-01-27
- Fixed binary file persistence in checkpoint system
- Images and other binary files now properly persist across page reloads
- Added base64 encoding/decoding for binary content in checkpoints
- Updated VFS updateFile to support ArrayBuffer content

## v1.5.0 - 2025-01-26
- Fixed TypeScript compilation error with shell tool oneOf parameter support  
- Enhanced Handlebars error handling with detection of invalid LLM-generated syntax
- Added helpful error messages for common Handlebars pattern mistakes

## v1.4.0 - 2025-01-26
- Improved LLM shell tool compatibility with natural command format support
- Shell tool now accepts both string ("ls -la /") and array (["ls", "-la", "/"]) formats
- Fixed system prompt confusion about model tool-calling capabilities
- Added automatic string-to-array conversion for better first-call success rates

## v1.3.0 - 2025-01-26
- Enhanced demo project with Handlebars templating for navigation and footer
- Added minimal Handlebars component to barebones template
- Improved template organization and maintainability

## v1.2.0 - 2025-01-26
- Fixed mobile streaming disconnection issue in workspace chat panel
- Mobile now properly displays real-time AI responses with tool calls
- Added missing scroll management for mobile chat during streaming
- Aligned mobile and desktop chat rendering behavior

## v1.1.0 - 2025-01-24
- Added Handlebars templating support (.hbs/.handlebars files)
- Templates automatically compile to static HTML on export
- LLM can now create reusable components with partials
- Improved code generation capabilities

## v1.0.0 - 2025-01-23
- Initial public release
- Multi-provider AI support (8 providers)
- Browser-based development environment
- Project management with checkpoints
- Session recovery and persistence
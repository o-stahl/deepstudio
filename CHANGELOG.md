# Changelog

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
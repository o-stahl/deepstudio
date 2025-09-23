import { ToolDefinition } from './types';

export const SHELL_TOOL_DEF: ToolDefinition = {
  name: 'shell',
  description: 'Run a command in the sandboxed VFS terminal. Provide argv vector in cmd array.',
  parameters: {
    type: 'object',
    properties: {
      cmd: {
        type: 'array',
        description: 'argv vector, e.g., ["cat","/index.html"]',
        items: { type: 'string' }
      },
      cwd: { type: 'string', description: 'working directory (ignored; paths are absolute under /)' },
      timeoutMs: { type: 'number', description: 'command timeout (ms)' }
    },
    required: ['cmd']
  }
};

export const JSON_PATCH_TOOL_DEF: ToolDefinition = {
  name: 'json_patch',
  description: 'Apply precise string-based patches to files using JSON operations. Reliable file editing with exact string matching.',
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute path to the file to modify (e.g., "/src/components/App.tsx")'
      },
      operations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['update', 'rewrite', 'replace_entity'],
              description: 'Operation type: "update" for string replacement, "rewrite" for complete file replacement, "replace_entity" for semantic entity replacement'
            },
            oldStr: {
              type: 'string',
              description: 'For "update": EXACT string to find and replace - copy directly from file content as seen with cat. MUST be unique in file. JSON escaping handled automatically.'
            },
            newStr: {
              type: 'string', 
              description: 'For "update": Replacement string'
            },
            content: {
              type: 'string',
              description: 'For "rewrite": Complete new file content'
            },
            selector: {
              type: 'string',
              description: 'For "replace_entity": Opening pattern to identify the entity (e.g., "<div className=\\"contact\\">", "const ContactForm = () => {", "function calculateTotal("). Copy the snippet starting at the first non-space character—do NOT include leading indentation, trailing whitespace, or extra escape characters. Ensure the selector is specific enough to be unique (add distinguishing attributes if necessary).'
            },
            replacement: {
              type: 'string',
              description: 'For "replace_entity": Complete new entity content to replace the identified entity'
            },
            entity_type: {
              type: 'string',
              description: 'For "replace_entity": Optional hint for boundary detection (html_element, react_component, function, css_rule, interface, type)'
            }
          },
          required: ['type']
        } as any,
        description: 'Array of patch operations to apply sequentially. Each "update" operation requires oldStr and newStr. Each "rewrite" operation requires content. Each "replace_entity" operation requires selector and replacement.'
      }
    },
    required: ['file_path', 'operations']
  }
};

import { VirtualFileSystem } from '@/lib/vfs';
import { logger } from '@/lib/utils';

export type StringPatchOperation = 
  | { type: 'update'; oldStr: string; newStr: string }
  | { type: 'rewrite'; content: string }
  | { type: 'replace_entity'; selector: string; replacement: string; entity_type?: string };

export type StringPatchResult = {
  applied: boolean;
  summary: string;
  warnings?: string[];
};

/**
 * Execute JSON-based string patch operations on a file
 * Much simpler and more reliable than the complex diff-based patch system
 */
export async function execStringPatch(
  vfs: VirtualFileSystem,
  projectId: string,
  filePath: string,
  operations: StringPatchOperation[]
): Promise<StringPatchResult> {
  const warnings: string[] = [];
  
  if (!filePath || !filePath.startsWith('/')) {
    return {
      applied: false,
      summary: 'Invalid file path',
      warnings: ['File path must be absolute and start with /']
    };
  }

  if (!operations || operations.length === 0) {
    return {
      applied: false,
      summary: 'Missing operations parameter',
      warnings: [`json_patch requires an operations array with at least one operation.

Required format:
{
  "file_path": "/path/to/file",
  "operations": [
    {
      "type": "update",
      "oldStr": "exact text to find",
      "newStr": "replacement text"
    }
  ]
}

Operation types:
• update: Replace exact string (oldStr must be unique in file)
• rewrite: Replace entire file content
• replace_entity: Replace entire code entity (function, class, etc.) by its opening pattern

Examples:
✅ Update text: {"file_path": "/index.html", "operations": [{"type": "update", "oldStr": "<title>Old</title>", "newStr": "<title>New</title>"}]}
✅ Rewrite file: {"file_path": "/style.css", "operations": [{"type": "rewrite", "content": "body { margin: 0; }"}]}
✅ Replace function: {"file_path": "/app.js", "operations": [{"type": "replace_entity", "selector": "function myFunc()", "replacement": "function myFunc() { return true; }"}]}

❌ Wrong - Missing operations: {"file_path": "/file.js"}
❌ Wrong - Empty operations: {"file_path": "/file.js", "operations": []}`]
    };
  }

  // Normalize path
  const normalizedPath = filePath.replace(/\/+/g, '/');

  try {
    // Read current file content (if it exists)
    let currentContent = '';
    let fileExists = true;
    
    try {
      const file = await vfs.readFile(projectId, normalizedPath);
      if (typeof file.content === 'string') {
        currentContent = file.content;
      } else {
        return {
          applied: false,
          summary: 'Cannot patch binary file',
          warnings: [`File ${normalizedPath} is binary and cannot be patched`]
        };
      }
    } catch (error: any) {
      if (error.message?.includes('not found')) {
        fileExists = false;
        currentContent = '';
        logger.debug(`[StringPatch] File ${normalizedPath} does not exist, will create it`);
      } else {
        throw error;
      }
    }

    // Apply operations sequentially
    let workingContent = currentContent;
    let operationsApplied = 0;

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      
      try {
        if (op.type === 'update') {
          const { oldStr, newStr } = op;
          
          // Validate required fields
          if (!oldStr) {
            warnings.push(`Operation ${i + 1}: oldStr is required for update operations`);
            continue;
          }
          
          // Check if oldStr exists in current content
          const occurrences = (workingContent.match(new RegExp(escapeRegExp(oldStr), 'g')) || []).length;
          
          if (occurrences === 0) {
            warnings.push(`Operation ${i + 1}: oldStr not found in file. Expected: "${truncateString(oldStr, 100)}"`);
            continue;
          }
          
          if (occurrences > 1) {
            warnings.push(`Operation ${i + 1}: oldStr appears ${occurrences} times in file, must be unique. String: "${truncateString(oldStr, 100)}"`);
            continue;
          }
          
          // Perform the replacement
          workingContent = workingContent.replace(oldStr, newStr ?? '');
          operationsApplied++;
          
        } else if (op.type === 'rewrite') {
          // Complete file rewrite
          workingContent = op.content ?? '';
          operationsApplied++;
          
        } else if (op.type === 'replace_entity') {
          // Replace entity using semantic boundary detection
          const { selector, replacement, entity_type } = op;
          
          // Validate required fields
          if (!selector) {
            warnings.push(`Operation ${i + 1}: selector is required for replace_entity operations`);
            continue;
          }
          
          if (replacement === undefined) {
            warnings.push(`Operation ${i + 1}: replacement is required for replace_entity operations`);
            continue;
          }
          
          // Perform entity replacement
          const entityResult = replaceEntity(workingContent, selector, replacement, entity_type);
          
          if (entityResult.success) {
            workingContent = entityResult.result!;
            operationsApplied++;
          } else {
            warnings.push(`Operation ${i + 1}: ${entityResult.error}`);
          }
          
        } else {
          warnings.push(`Operation ${i + 1}: Unknown operation type: ${(op as any).type}`);
        }
        
      } catch (error: any) {
        warnings.push(`Operation ${i + 1}: ${error.message || String(error)}`);
      }
    }

    // Write the result back to the file
    if (operationsApplied > 0) {
      if (fileExists) {
        await vfs.updateFile(projectId, normalizedPath, workingContent);
      } else {
        await vfs.createFile(projectId, normalizedPath, workingContent);
      }
    }

    const summary = operationsApplied > 0 
      ? `Applied ${operationsApplied}/${operations.length} operations to ${normalizedPath}`
      : `No operations applied to ${normalizedPath}`;

    return {
      applied: operationsApplied > 0,
      summary,
      warnings: warnings.length > 0 ? warnings : undefined
    };

  } catch (error: any) {
    const errorMessage = error.message || String(error);
    logger.error(`[StringPatch] Failed to patch ${normalizedPath}:`, errorMessage);
    
    return {
      applied: false,
      summary: `Failed to patch ${normalizedPath}`,
      warnings: [`Error: ${errorMessage}`]
    };
  }
}

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Truncate string for display in warnings
 */
function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  if (maxLength <= 3) return str.substring(0, Math.max(0, maxLength));
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Find and replace a semantic entity in content
 */
function replaceEntity(content: string, selector: string, replacement: string, entityType?: string): { 
  success: boolean; 
  result?: string; 
  error?: string 
} {
  try {
    // Find the selector in the content, tolerating indentation/trailing newlines
    const selectorMatch = findSelectorMatch(content, selector);
    if (!selectorMatch) {
      return { success: false, error: `Selector not found: "${truncateString(selector, 100)}"` };
    }

    const { index: selectorIndex, normalizedSelector } = selectorMatch;

    // Detect entity boundaries based on type or auto-detect
    const entityBoundary = detectEntityBoundary(content, selectorIndex, normalizedSelector, entityType);
    if (!entityBoundary) {
      return { success: false, error: `Could not detect entity boundary for selector: "${truncateString(selector, 100)}"` };
    }

    // Replace the entity
    const beforeEntity = content.substring(0, entityBoundary.start);
    const afterEntity = content.substring(entityBoundary.end);
    const result = beforeEntity + replacement + afterEntity;

    return { success: true, result };
  } catch (error: any) {
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Locate selector within content while relaxing leading indentation and trailing whitespace
 */
function findSelectorMatch(content: string, selector: string): { index: number; normalizedSelector: string } | null {
  const variants: string[] = [];
  const seen = new Set<string>();

  const addVariant = (value: string) => {
    if (!value) return;
    if (seen.has(value)) return;
    seen.add(value);
    variants.push(value);
  };

  addVariant(selector);
  addVariant(selector.replace(/^\s+/, ''));
  addVariant(selector.replace(/\s+$/, ''));
  addVariant(selector.replace(/^\s+/, '').replace(/\s+$/, ''));

  for (const variant of variants) {
    if (!variant) continue;
    const index = content.indexOf(variant);
    if (index !== -1) {
      return { index, normalizedSelector: variant };
    }
  }

  return null;
}

/**
 * Detect the boundaries of a code entity
 */
function detectEntityBoundary(
  content: string, 
  selectorIndex: number, 
  selector: string, 
  entityType?: string
): { start: number; end: number } | null {
  // Auto-detect entity type if not provided
  const detectedType = entityType || autoDetectEntityType(selector);
  
  switch (detectedType) {
    case 'html_element':
      return detectHtmlElementBoundary(content, selectorIndex, selector);
    case 'react_component':
      return detectReactComponentBoundary(content, selectorIndex);
    case 'function':
      return detectFunctionBoundary(content, selectorIndex);
    case 'css_rule':
      return detectCssRuleBoundary(content, selectorIndex);
    case 'interface':
    case 'type':
      return detectTypeBoundary(content, selectorIndex);
    default:
      // Default to bracket matching
      return detectBracketBoundary(content, selectorIndex);
  }
}

/**
 * Auto-detect entity type from selector
 */
function autoDetectEntityType(selector: string): string {
  if (selector.startsWith('<') && selector.includes('>')) {
    return 'html_element';
  }
  if (selector.includes('React.FC') || selector.includes(': FC<')) {
    return 'react_component';
  }
  if (selector.includes('function ') || selector.includes(' = (') || selector.includes(' => {')) {
    return 'function';
  }
  if (selector.startsWith('.') || selector.startsWith('#')) {
    return 'css_rule';
  }
  if (selector.includes('interface ') || selector.includes('type ')) {
    return selector.includes('interface ') ? 'interface' : 'type';
  }
  return 'bracket_matched';
}

/**
 * Detect HTML element boundaries by matching opening and closing tags
 */
function detectHtmlElementBoundary(content: string, selectorIndex: number, selector: string): { start: number; end: number } | null {
  // Validate inputs
  if (selectorIndex < 0 || selectorIndex >= content.length) return null;
  
  // Extract tag name from selector
  const tagMatch = selector.match(/<(\w+)(?:\s|>)/);
  if (!tagMatch) return null;
  
  const tagName = tagMatch[1];
  const start = Math.max(0, selectorIndex);
  
  // Check if it's a self-closing tag
  if (selector.includes('/>')) {
    const end = content.indexOf('/>', selectorIndex) + 2;
    return { start, end };
  }
  
  // Find matching closing tag
  let depth = 0;
  let pos = selectorIndex;
  
  while (pos < content.length) {
    const openMatch = content.substring(pos).match(new RegExp(`<${tagName}(?:\\s[^>]*)?>`));
    const closeMatch = content.substring(pos).match(new RegExp(`</${tagName}>`));
    
    let nextOpen = -1;
    let nextClose = -1;
    
    if (openMatch) {
      const openIndex = content.substring(pos).indexOf(openMatch[0]);
      nextOpen = openIndex !== -1 ? pos + openIndex : -1;
    }
    
    if (closeMatch) {
      const closeIndex = content.substring(pos).indexOf(closeMatch[0]);
      nextClose = closeIndex !== -1 ? pos + closeIndex : -1;
    }
    
    if (nextClose === -1) break; // No closing tag found
    
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + openMatch![0].length;
    } else {
      if (depth === 0) {
        return { start, end: nextClose + closeMatch![0].length };
      }
      depth--;
      if (depth <= 0) {
        return { start, end: nextClose + closeMatch![0].length };
      }
      pos = nextClose + closeMatch![0].length;
    }
  }

  return null;
}

/**
 * Detect function/component boundaries using bracket matching
 */
function detectReactComponentBoundary(content: string, selectorIndex: number): { start: number; end: number } | null {
  return detectBracketBoundary(content, selectorIndex);
}

/**
 * Detect function boundaries using bracket matching
 */
function detectFunctionBoundary(content: string, selectorIndex: number): { start: number; end: number } | null {
  return detectBracketBoundary(content, selectorIndex);
}

/**
 * Detect CSS rule boundaries using bracket matching
 */
function detectCssRuleBoundary(content: string, selectorIndex: number): { start: number; end: number } | null {
  return detectBracketBoundary(content, selectorIndex);
}

/**
 * Detect TypeScript type/interface boundaries
 */
function detectTypeBoundary(content: string, selectorIndex: number): { start: number; end: number } | null {
  return detectBracketBoundary(content, selectorIndex);
}

/**
 * Generic bracket matching for code blocks
 */
function detectBracketBoundary(content: string, selectorIndex: number): { start: number; end: number } | null {
  // Validate inputs
  if (selectorIndex < 0 || selectorIndex >= content.length) return null;
  
  // Find the opening bracket
  const openBracketPos = content.indexOf('{', selectorIndex);
  if (openBracketPos === -1) return null;
  
  const start = Math.max(0, selectorIndex);
  let depth = 0;
  let pos = openBracketPos;
  
  while (pos < content.length) {
    const char = content[pos];
    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return { start, end: pos + 1 };
      }
    }
    pos++;
  }
  
  return null;
}

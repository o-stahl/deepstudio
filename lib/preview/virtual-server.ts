import { VirtualFileSystem } from '../vfs';
import { VirtualFile } from '../vfs/types';
import { ProcessedFile, Route, CompiledProject } from './types';
import Handlebars from 'handlebars';

export class VirtualServer {
  private vfs: VirtualFileSystem;
  private projectId: string;
  private baseUrl: string;
  private blobUrls: Map<string, string> = new Map();
  private fileHashes: Map<string, string> = new Map();
  private handlebars: typeof Handlebars;
  private templateCache: Map<string, HandlebarsTemplateDelegate> = new Map();
  private partialsRegistered: boolean = false;

  constructor(vfs: VirtualFileSystem, projectId: string, existingBlobUrls?: Map<string, string>) {
    this.vfs = vfs;
    this.projectId = projectId;
    this.baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    if (existingBlobUrls) {
      this.blobUrls = new Map(existingBlobUrls);
    }
    
    // Initialize Handlebars instance
    this.handlebars = Handlebars.create();
    this.registerHelpers();
  }

  private registerHelpers(): void {
    // Register common comparison helpers that LLMs expect
    this.handlebars.registerHelper('eq', (a: any, b: any) => a === b);
    this.handlebars.registerHelper('ne', (a: any, b: any) => a !== b);
    this.handlebars.registerHelper('lt', (a: any, b: any) => a < b);
    this.handlebars.registerHelper('gt', (a: any, b: any) => a > b);
    this.handlebars.registerHelper('lte', (a: any, b: any) => a <= b);
    this.handlebars.registerHelper('gte', (a: any, b: any) => a >= b);
    
    // Logical helpers
    this.handlebars.registerHelper('and', function(this: any) {
      const args = Array.prototype.slice.call(arguments, 0, -1);
      return args.every((arg: any) => arg);
    });
    this.handlebars.registerHelper('or', function(this: any) {
      const args = Array.prototype.slice.call(arguments, 0, -1);
      return args.some((arg: any) => arg);
    });
    this.handlebars.registerHelper('not', (value: any) => !value);
    
    // Math helpers
    this.handlebars.registerHelper('add', (a: number, b: number) => a + b);
    this.handlebars.registerHelper('subtract', (a: number, b: number) => a - b);
    this.handlebars.registerHelper('multiply', (a: number, b: number) => a * b);
    this.handlebars.registerHelper('divide', (a: number, b: number) => a / b);
    
    // String helpers
    this.handlebars.registerHelper('uppercase', (str: string) => str?.toUpperCase());
    this.handlebars.registerHelper('lowercase', (str: string) => str?.toLowerCase());
    this.handlebars.registerHelper('concat', function(this: any) {
      const args = Array.prototype.slice.call(arguments, 0, -1);
      return args.join('');
    });
    
    // Utility helpers
    this.handlebars.registerHelper('json', (context: any) => JSON.stringify(context, null, 2));
    this.handlebars.registerHelper('formatDate', (date: Date | string) => {
      const d = new Date(date);
      return d.toLocaleDateString();
    });
  }

  private async registerPartials(): Promise<void> {
    if (this.partialsRegistered) {
      return;
    }
    
    try {
      // Look for templates in /templates directory
      const templateFiles = await this.vfs.listDirectory(this.projectId, '/templates');
      
      
      for (const file of templateFiles) {
        if (file.type === 'template' || file.path.endsWith('.hbs') || file.path.endsWith('.handlebars')) {
          // More robust partial name extraction
          let partialName = file.name
            .replace(/\.hbs$/, '')
            .replace(/\.handlebars$/, '');
          
          // Remove any leading path components if they exist in the name
          if (partialName.includes('/')) {
            partialName = partialName.split('/').pop() || partialName;
          }
          
          const content = file.content as string;
          this.handlebars.registerPartial(partialName, content);
        }
      }
      
      this.partialsRegistered = true;
    } catch (error) {
      // Templates directory might not exist, which is fine
    }
  }

  private async compileTemplate(templatePath: string, context: any = {}): Promise<string> {
    // Check cache first
    let compiled = this.templateCache.get(templatePath);
    
    if (!compiled) {
      try {
        const file = await this.vfs.readFile(this.projectId, templatePath);
        const templateContent = file.content as string;
        compiled = this.handlebars.compile(templateContent);
        this.templateCache.set(templatePath, compiled);
      } catch (error) {
        console.error(`Failed to compile template ${templatePath}:`, error);
        return '';
      }
    }
    
    return compiled(context);
  }

  async compileProject(incrementalUpdate = false): Promise<CompiledProject> {
    // Register partials before processing
    await this.registerPartials();
    
    const files = await this.vfs.listDirectory(this.projectId, '/');
    
    const oldBlobUrls = new Map(this.blobUrls);
    const newBlobUrls = new Map<string, string>();
    const rawProcessedFiles: ProcessedFile[] = [];
    
    // First pass: Create blob URLs for all non-HTML files (images, JS, etc.)
    for (const file of files) {
      let processedFile: ProcessedFile;
      
      // Skip template files and HTML files in first pass
      if (file.type === 'template' || file.type === 'html' || file.type === 'css') {
        continue;
      }
      
      if (file.type === 'image' || file.type === 'video') {
        processedFile = {
          path: file.path,
          content: file.content,
          mimeType: file.mimeType
        };
      } else if (file.type === 'js') {
        processedFile = await this.processJS(file);
      } else {
        processedFile = {
          path: file.path,
          content: file.content as string,
          mimeType: file.mimeType
        };
      }
      
      const contentHash = this.hashContent(processedFile.content);
      const previousHash = this.fileHashes.get(processedFile.path);
      
      if (incrementalUpdate && previousHash === contentHash && oldBlobUrls.has(processedFile.path)) {
        const existingUrl = oldBlobUrls.get(processedFile.path)!;
        newBlobUrls.set(processedFile.path, existingUrl);
        processedFile.blobUrl = existingUrl;
        oldBlobUrls.delete(processedFile.path);
      } else {
        const blob = new Blob([processedFile.content], { type: processedFile.mimeType });
        const blobUrl = URL.createObjectURL(blob);
        newBlobUrls.set(processedFile.path, blobUrl);
        processedFile.blobUrl = blobUrl;
        this.fileHashes.set(processedFile.path, contentHash);
      }
      
      rawProcessedFiles.push(processedFile);
    }
    
    // Second pass: Process HTML files with available blob URLs
    for (const file of files) {
      if (file.type !== 'html') {
        continue;
      }
      
      const processedFile = await this.processHTML(file, newBlobUrls);
      
      const contentHash = this.hashContent(processedFile.content);
      const previousHash = this.fileHashes.get(processedFile.path);
      
      if (incrementalUpdate && previousHash === contentHash && oldBlobUrls.has(processedFile.path)) {
        const existingUrl = oldBlobUrls.get(processedFile.path)!;
        newBlobUrls.set(processedFile.path, existingUrl);
        processedFile.blobUrl = existingUrl;
        oldBlobUrls.delete(processedFile.path);
      } else {
        const blob = new Blob([processedFile.content], { type: processedFile.mimeType });
        const blobUrl = URL.createObjectURL(blob);
        newBlobUrls.set(processedFile.path, blobUrl);
        processedFile.blobUrl = blobUrl;
        this.fileHashes.set(processedFile.path, contentHash);
      }
      
      rawProcessedFiles.push(processedFile);
    }
    
    const processedFiles = [...rawProcessedFiles];
    for (const file of files) {
      if (file.type === 'css') {
        const processedFile = await this.processCSS(file, newBlobUrls);
        
        const contentHash = this.hashContent(processedFile.content);
        const previousHash = this.fileHashes.get(processedFile.path);
        
        if (incrementalUpdate && previousHash === contentHash && oldBlobUrls.has(processedFile.path)) {
          const existingUrl = oldBlobUrls.get(processedFile.path)!;
          newBlobUrls.set(processedFile.path, existingUrl);
          processedFile.blobUrl = existingUrl;
          oldBlobUrls.delete(processedFile.path);
        } else {
          const blob = new Blob([processedFile.content], { type: processedFile.mimeType });
          const blobUrl = URL.createObjectURL(blob);
          newBlobUrls.set(processedFile.path, blobUrl);
          processedFile.blobUrl = blobUrl;
          this.fileHashes.set(processedFile.path, contentHash);
        }
        
        processedFiles.push(processedFile);
      }
    }
    
    const routes = this.generateRoutes(files);
    
    if (incrementalUpdate) {
      for (const [, url] of oldBlobUrls) {
        URL.revokeObjectURL(url);
      }
    } else if (!incrementalUpdate) {
      this.cleanupBlobUrls();
    }
    
    this.blobUrls = newBlobUrls;

    return {
      entryPoint: '/index.html',
      files: processedFiles,
      routes,
      blobUrls: this.blobUrls
    };
  }
  
  private hashContent(content: string | ArrayBuffer): string {
    let hash = 0;
    
    if (content instanceof ArrayBuffer) {
      const view = new Uint8Array(content);
      for (let i = 0; i < Math.min(view.length, 10000); i++) {
        hash = ((hash << 5) - hash) + view[i];
        hash = hash & hash;
      }
    } else {
      for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
    }
    
    return hash.toString(36);
  }

  private async processFiles(files: VirtualFile[]): Promise<ProcessedFile[]> {
    const processed: ProcessedFile[] = [];

    for (const file of files) {
      if (file.type === 'html') {
        processed.push(await this.processHTML(file));
      } else if (file.type === 'css') {
        processed.push(await this.processCSS(file, new Map()));
      } else if (file.type === 'js') {
        processed.push(await this.processJS(file));
      } else if (file.type === 'image' || file.type === 'video') {
        processed.push({
          path: file.path,
          content: file.content, // Can be ArrayBuffer or string
          mimeType: file.mimeType
        });
      } else {
        processed.push({
          path: file.path,
          content: file.content as string,
          mimeType: file.mimeType
        });
      }
    }

    return processed;
  }

  private async processHTML(file: VirtualFile, blobUrls?: Map<string, string>): Promise<ProcessedFile> {
    let content = file.content as string;

    // Process Handlebars templates first
    content = await this.processHandlebarsTemplates(content);
    
    // Then process internal references with available blob URLs
    content = await this.processInternalReferences(content, blobUrls);
    
    // Inject VFS asset interceptor for transparent HTTP requests
    // Always inject the interceptor, even if no blob URLs yet (for future dynamic loading)
    const blobUrlMap = blobUrls ? Object.fromEntries(blobUrls) : {};
    const vfsScript = `<script>
// VFS Asset Interceptor - Auto-injected by DeepStudio
(function() {
  const vfsBlobUrls = ${JSON.stringify(blobUrlMap)};
  
  // Helper function to resolve VFS paths to blob URLs
  function resolveVfsUrl(url) {
    if (!url || typeof url !== 'string') return url;
    if (url.startsWith('/assets/') && vfsBlobUrls[url]) {
      return vfsBlobUrls[url];
    }
    return url;
  }
  
  // Intercept Image src setter to handle ALL image loading
  const originalSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    get: function() {
      return originalSrcDescriptor.get.call(this);
    },
    set: function(value) {
      const resolvedUrl = resolveVfsUrl(value);
      return originalSrcDescriptor.set.call(this, resolvedUrl);
    },
    enumerable: true,
    configurable: true
  });
  
  // Intercept setAttribute for src attributes
  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if ((name === 'src' || name === 'href') && this instanceof HTMLImageElement) {
      value = resolveVfsUrl(value);
    }
    return originalSetAttribute.call(this, name, value);
  };
  
  // Intercept innerHTML to catch template-generated images
  const originalInnerHTMLDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(Element.prototype, 'innerHTML', {
    get: function() {
      return originalInnerHTMLDescriptor.get.call(this);
    },
    set: function(value) {
      if (typeof value === 'string' && value.includes('/assets/')) {
        // Replace asset URLs in the HTML string before setting
        const srcRegex = new RegExp('src=["\\']([^"\\']*/assets/[^"\\']*)["\\']', 'g');
        value = value.replace(srcRegex, function(match, url) {
          const resolvedUrl = resolveVfsUrl(url);
          if (resolvedUrl !== url) {
            return match.replace(url, resolvedUrl);
          }
          return match;
        });
      }
      return originalInnerHTMLDescriptor.set.call(this, value);
    },
    enumerable: true,
    configurable: true
  });
  
  // Intercept Image constructor
  const OriginalImage = window.Image;
  window.Image = function(...args) {
    const img = new OriginalImage(...args);
    // Override src setter for this instance too
    const descriptor = Object.getOwnPropertyDescriptor(img, 'src') || 
                      Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (descriptor) {
      Object.defineProperty(img, 'src', {
        get: descriptor.get,
        set: function(value) {
          const resolvedUrl = resolveVfsUrl(value);
          return originalSrcDescriptor.set.call(this, resolvedUrl);
        },
        enumerable: true,
        configurable: true
      });
    }
    return img;
  };
  // Preserve original Image properties
  Object.setPrototypeOf(window.Image, OriginalImage);
  window.Image.prototype = OriginalImage.prototype;
  
  // Intercept createElement for img elements
  const originalCreateElement = document.createElement;
  document.createElement = function(tagName, options) {
    const element = originalCreateElement.call(this, tagName, options);
    if (tagName.toLowerCase() === 'img') {
      const originalSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      Object.defineProperty(element, 'src', {
        get: function() {
          return originalSrcDescriptor.get.call(this);
        },
        set: function(value) {
          const resolvedUrl = resolveVfsUrl(value);
          return originalSrcDescriptor.set.call(this, resolvedUrl);
        },
        enumerable: true,
        configurable: true
      });
    }
    return element;
  };
  
  // Intercept fetch requests to VFS assets
  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    const url = typeof input === 'string' ? input : input.url;
    const resolvedUrl = resolveVfsUrl(url);
    
    if (resolvedUrl !== url) {
      return originalFetch(resolvedUrl, init);
    }
    
    return originalFetch(input, init);
  };
  
  // Intercept XMLHttpRequest for older code
  const OriginalXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function() {
    const xhr = new OriginalXHR();
    const originalOpen = xhr.open;
    
    xhr.open = function(method, url, ...args) {
      const resolvedUrl = resolveVfsUrl(url);
      return originalOpen.call(this, method, resolvedUrl, ...args);
    };
    
    return xhr;
  };
  
  // Process any existing images in the DOM when ready
  function processExistingImages() {
    const images = document.querySelectorAll('img[src*="/assets/"]');
    images.forEach(img => {
      const currentSrc = img.src;
      const resolvedSrc = resolveVfsUrl(currentSrc);
      if (resolvedSrc !== currentSrc) {
        img.src = resolvedSrc;
      }
    });
  }
  
  // Use MutationObserver to catch dynamically added images
  function setupMutationObserver() {
    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
          mutation.addedNodes.forEach(function(node) {
            if (node.nodeType === 1) { // Element node
              if (node.tagName === 'IMG' && node.src && node.src.includes('/assets/')) {
                const resolvedSrc = resolveVfsUrl(node.src);
                if (resolvedSrc !== node.src) {
                  node.src = resolvedSrc;
                }
              }
              // Also check children
              const childImages = node.querySelectorAll && node.querySelectorAll('img[src*="/assets/"]');
              if (childImages) {
                childImages.forEach(img => {
                  const resolvedSrc = resolveVfsUrl(img.src);
                  if (resolvedSrc !== img.src) {
                    img.src = resolvedSrc;
                  }
                });
              }
            }
          });
        });
      });
      
      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
      });
    }
  }
  
  // Setup everything when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      processExistingImages();
      setupMutationObserver();
    });
  } else {
    processExistingImages();
    setupMutationObserver();
  }
})();
</script>`;
      
    // Insert in head for early execution
    if (content.includes('</head>')) {
      content = content.replace('</head>', vfsScript + '\n</head>');
    } else if (content.includes('<body>')) {
      content = content.replace('<body>', vfsScript + '\n<body>');
    } else {
      content = vfsScript + '\n' + content;
    }

    return {
      path: file.path,
      content,
      mimeType: file.mimeType
    };
  }
  
  private async processHandlebarsTemplates(content: string): Promise<string> {
    // Ensure partials are registered
    await this.registerPartials();
    
    try {
      // Check for common invalid LLM-generated patterns before compilation
      const invalidPatterns = this.detectInvalidHandlebarsPatterns(content);
      if (invalidPatterns.length > 0) {
        const errorMessages = invalidPatterns.map(pattern => `❌ ${pattern.error}\n💡 ${pattern.suggestion}`).join('\n\n');
        return `<!-- Handlebars Syntax Error -->\n<div style="background: #fee; border: 1px solid #f99; padding: 1rem; margin: 1rem; border-radius: 4px; font-family: monospace;">\n<h3 style="color: #c33; margin: 0 0 1rem 0;">⚠️ Handlebars Template Error</h3>\n<pre style="margin: 0; white-space: pre-wrap;">${errorMessages}</pre>\n</div>\n<!-- Original content:\n${content}\n-->`;
      }

      // Look for a data.json file for template context
      let context = {};
      try {
        const dataFile = await this.vfs.readFile(this.projectId, '/data.json');
        context = JSON.parse(dataFile.content as string);
      } catch {
        // No data file, use empty context
      }
      
      // Compile the content as a Handlebars template
      const template = this.handlebars.compile(content);
      const result = template(context);
      return result;
    } catch (error) {
      console.error('VirtualServer: Error processing Handlebars templates:', error);
      
      // Return a helpful error message instead of original content
      const errorMessage = error instanceof Error ? error.message : String(error);
      return `<!-- Handlebars Compilation Error -->\n<div style="background: #fee; border: 1px solid #f99; padding: 1rem; margin: 1rem; border-radius: 4px; font-family: monospace;">\n<h3 style="color: #c33; margin: 0 0 1rem 0;">⚠️ Handlebars Template Error</h3>\n<p><strong>Error:</strong> ${errorMessage}</p>\n<p><strong>Common fixes:</strong></p>\n<ul>\n<li>Check for typos in helper names and partial references</li>\n<li>Ensure all opening tags have matching closing tags</li>\n<li>Verify partial names exist in /templates/ directory</li>\n<li>Use <code>{{> partialName}}</code> syntax, not <code>(> partialName)</code></li>\n</ul>\n</div>\n<!-- Original content:\n${content}\n-->`;
    }
  }

  private detectInvalidHandlebarsPatterns(content: string): Array<{error: string, suggestion: string}> {
    const patterns = [];
    
    // Pattern 1: Invalid (> partial) syntax in parameters
    const invalidPartialInParam = /\w+\s*=\s*\(\s*>\s*[\w-]+\s*\)/g;
    if (invalidPartialInParam.test(content)) {
      patterns.push({
        error: "Invalid syntax: Using (> partial) as parameter value",
        suggestion: "Use string-based dynamic partials: content=\"partial-name\" then {{> (lookup this 'content')}}"
      });
    }
    
    // Pattern 2: Common typos in partial syntax
    const typoPartialSyntax = /\{\{\s*>\s*\(\s*>\s*[\w-]+\s*\)\s*\}\}/g;
    if (typoPartialSyntax.test(content)) {
      patterns.push({
        error: "Invalid syntax: Double partial reference {{> (> partial)}}",
        suggestion: "Use {{> partialName}} for static partials or {{> (lookup data 'partialName')}} for dynamic"
      });
    }
    
    // Pattern 3: Missing quotes in parameter values (literal strings with spaces)
    const unquotedParams = /\{\{\s*>\s*[\w-]+\s+\w+\s*=\s*[^"'\s}][^}]*\s[^}]*(?:\s|}})/g;
    if (unquotedParams.test(content)) {
      patterns.push({
        error: "Missing quotes in parameter values",
        suggestion: "Wrap parameter values in quotes: title=\"My Title\" not title=My Title"
      });
    }
    
    return patterns;
  }

  private async processCSS(file: VirtualFile, blobUrls: Map<string, string>): Promise<ProcessedFile> {
    let content = file.content as string;

    content = await this.processUrlReferences(content, blobUrls);

    return {
      path: file.path,
      content,
      mimeType: file.mimeType
    };
  }

  private async processJS(file: VirtualFile): Promise<ProcessedFile> {
    const content = file.content as string;

    return {
      path: file.path,
      content,
      mimeType: file.mimeType
    };
  }

  private isAssetReference(url: string): boolean {
    // Asset extensions that should be converted to blob URLs
    const assetExtensions = [
      '.css', '.js', '.jsx', '.ts', '.tsx',
      '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
      '.woff', '.woff2', '.ttf', '.otf', '.eot',
      '.mp4', '.webm', '.ogg', '.mp3', '.wav',
      '.pdf', '.zip', '.json', '.xml'
    ];
    
    // Extract extension from URL (handle query params and fragments)
    const cleanUrl = url.split('?')[0].split('#')[0];
    const extension = cleanUrl.substring(cleanUrl.lastIndexOf('.')).toLowerCase();
    
    return assetExtensions.includes(extension);
  }

  private async processInternalReferences(content: string, blobUrls?: Map<string, string>): Promise<string> {
    const files = await this.vfs.listDirectory(this.projectId, '/');
    
    // Use provided blob URLs or fall back to instance blob URLs
    const urlMap = blobUrls || this.blobUrls;
    
    const patterns = [
      /href="([^"]+)"/g,
      /src="([^"]+)"/g,
      /href='([^']+)'/g,
      /src='([^']+)'/g
    ];

    let processed = content;
    for (const pattern of patterns) {
      processed = processed.replace(pattern, (match, url) => {
        if (url.startsWith('http') || url.startsWith('data:') || url.startsWith('//') || url.startsWith('blob:') || url.startsWith('#')) {
          return match;
        }

        // For href attributes, only convert asset references to blob URLs
        // Leave navigation links (HTML pages and routes) as-is for proper routing
        const isHref = match.includes('href=');
        if (isHref && !this.isAssetReference(url)) {
          return match; // Keep navigation links unchanged
        }

        const normalizedPath = this.normalizePath(url);
        
        const fileExists = files.some(f => f.path === normalizedPath);
        if (fileExists) {
          // Check if we have a blob URL for this file
          const blobUrl = urlMap.get(normalizedPath);
          if (blobUrl) {
            // Replace the URL with the blob URL
            return match.replace(url, blobUrl);
          }
        }

        return match;
      });
    }

    return processed;
  }

  private async processUrlReferences(content: string, blobUrls: Map<string, string>): Promise<string> {
    return content.replace(/url\(['"]?([^'")]+)['"]?\)/g, (match, url) => {
      if (url.startsWith('http') || url.startsWith('data:') || url.startsWith('//') || url.startsWith('blob:')) {
        return match;
      }

      const normalizedPath = this.normalizePath(url);
      
      const blobUrl = blobUrls.get(normalizedPath);
      if (blobUrl) {
        return `url('${blobUrl}')`;
      }

      return match;
    });
  }

  private normalizePath(path: string): string {
    if (path.startsWith('./')) {
      path = path.slice(2);
    }

    if (!path.startsWith('/')) {
      path = '/' + path;
    }

    if (!path.includes('.') && !path.endsWith('/')) {
      const htmlPath = path + '.html';
      return htmlPath;
    }

    return path;
  }

  private generateRoutes(files: VirtualFile[]): Route[] {
    const htmlFiles = files.filter(f => f.type === 'html');
    
    return htmlFiles.map(file => {
      const content = file.content as string;
      const titleMatch = content.match(/<title>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1] : file.name.replace('.html', '');

      const routePath = file.path.replace('.html', '') || '/';

      return {
        path: routePath === '/index' ? '/' : routePath,
        file: file.path,
        title
      };
    });
  }

  private extractTitle(content: string): string {
    const match = content.match(/<title>([^<]+)<\/title>/i);
    return match ? match[1] : 'Untitled Page';
  }

  cleanupBlobUrls(): void {
    for (const url of this.blobUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.blobUrls.clear();
    
    // Also clear template cache and re-register partials on next compile
    this.templateCache.clear();
    this.partialsRegistered = false;
  }

  async getCompiledFile(path: string): Promise<ProcessedFile | null> {
    try {
      const file = await this.vfs.readFile(this.projectId, path);
      
      if (file.type === 'html') {
        return await this.processHTML(file, this.blobUrls);
      } else if (file.type === 'css') {
        return await this.processCSS(file, new Map());
      } else if (file.type === 'js') {
        return await this.processJS(file);
      } else {
        return {
          path: file.path,
          content: file.content as string,
          mimeType: file.mimeType
        };
      }
    } catch {
      return null;
    }
  }
}

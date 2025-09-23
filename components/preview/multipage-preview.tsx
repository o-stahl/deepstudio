'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { VirtualServer } from '@/lib/preview/virtual-server';
import { 
  CompiledProject, 
  PreviewMessage, 
  FocusContextPayload, 
  PreviewHostMessage 
} from '@/lib/preview/types';
import { vfs } from '@/lib/vfs';
import { Button } from '@/components/ui/button';
import { 
  RefreshCw, 
  Smartphone, 
  Tablet, 
  Monitor,
  ChevronLeft,
  ChevronRight,
  Home,
  Eye,
  Crosshair,
  X
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn, logger } from '@/lib/utils';

interface MultipagePreviewProps {
  projectId: string;
  currentPath?: string;
  refreshTrigger?: number;
  onFocusSelection?: (selection: FocusContextPayload | null) => void;
  hasFocusTarget?: boolean;
  onClose?: () => void;
}

type DeviceSize = 'mobile' | 'tablet' | 'desktop' | 'responsive';

const DEVICE_SIZES: Record<DeviceSize, { width?: string; height?: string; maxHeight?: string; maxWidth?: string }> = {
  mobile: { width: '375px', height: '100%', maxHeight: '667px' },
  tablet: { width: '768px', height: '100%', maxHeight: '1024px' },
  desktop: { width: '100%', height: '100%', maxHeight: '900px', maxWidth: '1440px' },
  responsive: { width: '100%', height: '100%' }
};

export function MultipagePreview({ 
  projectId, 
  refreshTrigger,
  onFocusSelection,
  hasFocusTarget = false,
  onClose
}: MultipagePreviewProps) {
  const [compiledProject, setCompiledProject] = useState<CompiledProject | null>(null);
  const [activePath, setActivePath] = useState('/');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deviceSize, setDeviceSize] = useState<DeviceSize>('tablet');
  const [navigationHistory, setNavigationHistory] = useState<string[]>(['/']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [iframeReady, setIframeReady] = useState(false);
  const [selectorActive, setSelectorActive] = useState(false);
  const crosshairButtonStyle = selectorActive
    ? { backgroundColor: 'var(--button-preview-active)', color: 'white' }
    : hasFocusTarget
      ? { backgroundColor: 'rgba(99, 102, 241, 0.12)', color: 'var(--button-preview-active)' }
      : {};
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const serverRef = useRef<VirtualServer | null>(null);
  const compiledProjectRef = useRef<CompiledProject | null>(null);
  const activePathRef = useRef<string>('/');
  const pendingLoadPath = useRef<string | null>(null);
  const selectorActiveRef = useRef(false);

  const postMessageToIframe = useCallback((message: PreviewHostMessage) => {
    if (!iframeRef.current || !iframeRef.current.contentWindow) {
      return;
    }
    try {
      iframeRef.current.contentWindow.postMessage(message, '*');
    } catch (err) {
      logger.warn('Failed to communicate with preview iframe', err);
    }
  }, []);

  const compilingRef = useRef(false);
  const pendingCompileOptionsRef = useRef<{ preserve: boolean; showLoading: boolean } | null>(null);
  const compileTimeoutRef = useRef<number | null>(null);
  const scheduledCompileOptionsRef = useRef<{ preserve: boolean; showLoading: boolean } | null>(null);

  const Header = () => (
    <div className="p-3 border-b bg-muted/70 flex items-center gap-2">
      <Eye 
        className="h-4 w-4 md:hidden" 
        style={{ color: 'var(--button-preview-active)' }} 
      />
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide preview"
          className="relative hidden h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-destructive md:flex group"
        >
          <Eye 
            className="h-4 w-4 transition-opacity group-hover:opacity-0" 
            style={{ color: 'var(--button-preview-active)' }} 
          />
          <X className="absolute h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      ) : (
        <Eye 
          className="hidden h-4 w-4 md:inline-flex" 
          style={{ color: 'var(--button-preview-active)' }} 
        />
      )}
      <h3 className="text-sm font-medium">Live Preview</h3>
    </div>
  );

  useEffect(() => {
    compiledProjectRef.current = compiledProject;
  }, [compiledProject]);

  useEffect(() => {
    selectorActiveRef.current = selectorActive;
    if (iframeReady) {
      postMessageToIframe({ type: 'selector-toggle', active: selectorActive });
    }
  }, [selectorActive, iframeReady, postMessageToIframe]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) {
      return;
    }
    const handleLoad = () => {
      postMessageToIframe({ type: 'selector-toggle', active: selectorActiveRef.current });
    };
    iframe.addEventListener('load', handleLoad);
    return () => {
      iframe.removeEventListener('load', handleLoad);
    };
  }, [iframeReady, postMessageToIframe]);

  useEffect(() => {
    activePathRef.current = activePath;
  }, [activePath]);

  useEffect(() => {
    if (iframeReady && pendingLoadPath.current && compiledProjectRef.current) {
      const pathToLoad = pendingLoadPath.current;
      pendingLoadPath.current = null;
      loadPage(pathToLoad, compiledProjectRef.current);
    }
  }, [iframeReady]);

  useEffect(() => {
    return () => {
      if (compileTimeoutRef.current) {
        window.clearTimeout(compileTimeoutRef.current);
      }
    };
  }, []);

  const compileAndLoadInternal = useCallback(async (preserveCurrentPath = false, showLoading = true) => {
    if (showLoading) {
      setLoading(true);
    }
    setError(null);

    try {
      await vfs.init();
      
      const currentPath = preserveCurrentPath ? activePathRef.current : null;
      
      if (serverRef.current) {
        serverRef.current.cleanupBlobUrls();
      }
      
      const server = new VirtualServer(vfs, projectId);
      serverRef.current = server;
      
      const compiled = await server.compileProject();
      setCompiledProject(compiled);
      compiledProjectRef.current = compiled;

      let pathToLoad = currentPath;
      if (!pathToLoad) {
        pathToLoad = compiled.blobUrls.has('/index.html') ? '/' : 
                     compiled.entryPoint || 
                     (compiled.routes.length > 0 ? compiled.routes[0].path : '/');
      }
      
      loadPage(pathToLoad, compiled);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compile project');
      logger.error('Compilation error:', err);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [projectId]);

  const compileAndLoad = useCallback((preserveCurrentPath: boolean = false, showLoading: boolean = true) => {
    if (compilingRef.current) {
      const pending = pendingCompileOptionsRef.current;
      pendingCompileOptionsRef.current = {
        preserve: (pending?.preserve ?? false) || preserveCurrentPath,
        showLoading: (pending?.showLoading ?? false) || showLoading
      };
      return;
    }

    const run = async (preserve: boolean, loadingFlag: boolean) => {
      compilingRef.current = true;
      try {
        await compileAndLoadInternal(preserve, loadingFlag);
      } finally {
        compilingRef.current = false;
        const pending = pendingCompileOptionsRef.current;
        pendingCompileOptionsRef.current = null;
        if (pending) {
          compileAndLoad(pending.preserve, pending.showLoading);
        }
      }
    };

    void run(preserveCurrentPath, showLoading);
  }, [compileAndLoadInternal]);

  const scheduleCompile = useCallback((preserveCurrentPath = false, showLoading = false) => {
    const pending = scheduledCompileOptionsRef.current;
    scheduledCompileOptionsRef.current = {
      preserve: (pending?.preserve ?? false) || preserveCurrentPath,
      showLoading: (pending?.showLoading ?? false) || showLoading
    };

    if (compileTimeoutRef.current) {
      window.clearTimeout(compileTimeoutRef.current);
    }

    compileTimeoutRef.current = window.setTimeout(() => {
      const options = scheduledCompileOptionsRef.current;
      scheduledCompileOptionsRef.current = null;
      compileTimeoutRef.current = null;
      if (options) {
        compileAndLoad(options.preserve, options.showLoading);
      }
    }, 150);
  }, [compileAndLoad]);


  useEffect(() => {
    compileAndLoad();
  }, [projectId, refreshTrigger, compileAndLoad]);

  useEffect(() => {
    const handleFileChange = () => {
      scheduleCompile(true);
    };

    const handleFileContentChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ projectId?: string }>;
      if (!customEvent.detail || customEvent.detail.projectId === projectId) {
        scheduleCompile(true);
      }
    };

    window.addEventListener('filesChanged', handleFileChange as EventListener);
    window.addEventListener('fileContentChanged', handleFileContentChange as EventListener);
    return () => {
      window.removeEventListener('filesChanged', handleFileChange as EventListener);
      window.removeEventListener('fileContentChanged', handleFileContentChange as EventListener);
    };
  }, [projectId, scheduleCompile]);


  const loadPage = (path: string, compiled?: CompiledProject) => {
    const projectToUse = compiled || compiledProjectRef.current || compiledProject;
    
    if (!projectToUse) {
      logger.warn('No compiled project available');
      return;
    }

    if (selectorActiveRef.current) {
      setSelectorActive(false);
    } else {
      postMessageToIframe({ type: 'selector-toggle', active: false });
    }
    
    if (!iframeRef.current || !iframeReady) {
      pendingLoadPath.current = path;
      return;
    }

    let normalizedPath = path;
    if (!normalizedPath.startsWith('/')) {
      normalizedPath = '/' + normalizedPath;
    }
    
    const route = projectToUse.routes.find(r => r.path === normalizedPath);
    let filePath: string;
    if (route) {
      filePath = route.file;
    } else if (normalizedPath === '/') {
      filePath = '/index.html';
    } else {
      filePath = normalizedPath + '.html';
    }
    
    const htmlFile = projectToUse.files.find(f => f.path === filePath);
    
    if (!htmlFile) {
      setError(`Page not found: ${path}`);
      const indexFile = projectToUse.files.find(f => f.path === '/index.html' || f.path === 'index.html');
      if (indexFile && path !== '/') {
        loadPage('/', compiled);
      }
      return;
    }

    let processedHtml = typeof htmlFile.content === 'string' 
      ? htmlFile.content 
      : new TextDecoder().decode(htmlFile.content as ArrayBuffer);
    
    processedHtml = processedHtml.replace(/href="([^"]+)"/g, (match, href) => {
      // Skip if not a CSS file or if it's an external URL
      if (!href.endsWith('.css') || href.startsWith('http') || href.startsWith('//')) {
        return match;
      }
      
      const normalizedPath = href.startsWith('/') ? href : '/' + href;
      const blobUrl = projectToUse.blobUrls.get(normalizedPath);
      
      if (blobUrl) {
        return `href="${blobUrl}"`;
      }
      return match;
    });
    
    // Replace JavaScript sources
    processedHtml = processedHtml.replace(/src="([^"]+)"/g, (match, src) => {
      if (!src.endsWith('.js') || src.startsWith('http') || src.startsWith('//')) {
        return match;
      }
      
      const normalizedPath = src.startsWith('/') ? src : '/' + src;
      const blobUrl = projectToUse.blobUrls.get(normalizedPath);
      
      if (blobUrl) {
        return `src="${blobUrl}"`;
      }
      return match;
    });
    
    processedHtml = processedHtml.replace(/src="([^"]+\.(png|jpg|jpeg|gif|svg|webp))"/gi, (match, imgPath) => {
      const normalizedImgPath = imgPath.startsWith('/') ? imgPath : '/' + imgPath;
      const blobUrl = projectToUse.blobUrls.get(normalizedImgPath);
      return blobUrl ? `src="${blobUrl}"` : match;
    });

    const navigationScript = `
      <script>
        (function() {
          const isInIframe = window !== window.parent;

          function resolveInternalPath(href) {
            let path = href;
            if (!path.startsWith('/')) {
              const currentPath = '${normalizedPath}';
              const currentDir = currentPath.substring(0, currentPath.lastIndexOf('/'));
              path = currentDir + '/' + path;
            }

            if (path.endsWith('.html')) {
              path = path.slice(0, -5);
            }
            if (path === '/index') {
              path = '/';
            }
            return path;
          }

          document.addEventListener('click', function(e) {
            const target = e.target && e.target.closest ? e.target.closest('a') : null;
            if (target && target.getAttribute) {
              const href = target.getAttribute('href');

              if (!href) {
                return;
              }

              if (href.startsWith('#')) {
                e.preventDefault();
                const targetId = href.substring(1);
                const targetElement = document.getElementById(targetId);
                if (targetElement) {
                  targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
                return;
              }

              const isExternal = href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//');
              if (!isExternal) {
                if (isInIframe) {
                  e.preventDefault();
                  window.parent.postMessage({
                    type: 'navigate',
                    path: resolveInternalPath(href)
                  }, '*');
                }
              } else {
                e.preventDefault();
                window.open(href, '_blank');
              }
            }
          });

          const selectorState = {
            active: false,
            overlay: null,
            lastTarget: null,
            previousCursor: ''
          };

          function isElement(node) {
            return node && node.nodeType === 1;
          }

          function ensureOverlay() {
            if (selectorState.overlay) {
              return selectorState.overlay;
            }
            const overlay = document.createElement('div');
            overlay.style.position = 'absolute';
            overlay.style.pointerEvents = 'none';
            overlay.style.border = '2px solid rgba(99, 102, 241, 0.95)';
            overlay.style.background = 'rgba(99, 102, 241, 0.08)';
            overlay.style.boxShadow = '0 0 0 4px rgba(99, 102, 241, 0.32), 0 20px 40px rgba(15, 23, 42, 0.28)';
            overlay.style.borderRadius = '12px';
            overlay.style.zIndex = '2147483647';
            overlay.style.transition = 'top 0.12s ease-out, left 0.12s ease-out, width 0.12s ease-out, height 0.12s ease-out';
            overlay.style.willChange = 'top, left, width, height';
            selectorState.overlay = overlay;
            document.body.appendChild(overlay);
            return overlay;
          }

          function positionOverlay(target) {
            if (!isElement(target)) {
              return;
            }
            const overlay = ensureOverlay();
            const rect = target.getBoundingClientRect();
            overlay.style.top = (rect.top + window.scrollY) + 'px';
            overlay.style.left = (rect.left + window.scrollX) + 'px';
            overlay.style.width = Math.max(rect.width, 1) + 'px';
            overlay.style.height = Math.max(rect.height, 1) + 'px';
            overlay.style.opacity = '1';
          }

          function clearOverlay() {
            if (selectorState.overlay && selectorState.overlay.parentElement) {
              selectorState.overlay.parentElement.removeChild(selectorState.overlay);
            }
            selectorState.overlay = null;
          }

          function buildDomPath(element) {
            if (!isElement(element)) {
              return '';
            }
            const segments = [];
            let current = element;
            while (current && current.nodeType === 1) {
              let segment = current.tagName.toLowerCase();
              if (current.id) {
                segment += '#' + current.id;
                segments.unshift(segment);
                break;
              }
              const parent = current.parentElement;
              if (parent) {
                const siblings = parent.children;
                let index = 0;
                for (let i = 0; i < siblings.length; i++) {
                  if (siblings[i].tagName === current.tagName) {
                    index++;
                  }
                  if (siblings[i] === current) {
                    if (index > 1) {
                      segment += ':nth-of-type(' + index + ')';
                    } else {
                      const hasSame = Array.from(siblings).some(function(child, childIndex) {
                        return childIndex !== i && child.tagName === current.tagName;
                      });
                      if (hasSame) {
                        segment += ':nth-of-type(' + index + ')';
                      }
                    }
                    break;
                  }
                }
              }
              segments.unshift(segment);
              current = parent;
            }
            return segments.join(' > ');
          }

          function gatherAttributes(element) {
            const attributes = {};
            if (!isElement(element) || !element.attributes) {
              return attributes;
            }
            const maxAttributes = 25;
            for (let i = 0; i < element.attributes.length && i < maxAttributes; i++) {
              const attr = element.attributes[i];
              if (!attr) continue;
              const name = attr.name;
              if (!name || name === 'style' || name.startsWith('on')) {
                continue;
              }
              attributes[name] = attr.value;
            }
            return attributes;
          }

          function handleMouseMove(event) {
            if (!selectorState.active) {
              return;
            }
            const target = isElement(event.target) ? event.target : (event.target && event.target.parentElement);
            if (!isElement(target) || target === selectorState.lastTarget) {
              return;
            }
            selectorState.lastTarget = target;
            positionOverlay(target);
          }

          function handleClick(event) {
            if (!selectorState.active) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === 'function') {
              event.stopImmediatePropagation();
            }
            const target = isElement(event.target) ? event.target : (event.target && event.target.parentElement);
            if (!isElement(target)) {
              disableSelector(false);
              return;
            }
            const payload = {
              domPath: buildDomPath(target),
              tagName: target.tagName.toLowerCase(),
              attributes: gatherAttributes(target),
              outerHTML: target.outerHTML || ''
            };
            if (isInIframe) {
              window.parent.postMessage({ type: 'selector-selection', payload: payload }, '*');
            }
            disableSelector(false);
          }

          function handleContextMenu(event) {
            if (!selectorState.active) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
          }

          function handleKeyDown(event) {
            if (!selectorState.active) {
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              disableSelector(true);
            }
          }

          function enableSelector() {
            if (selectorState.active) {
              return;
            }
            selectorState.active = true;
            selectorState.previousCursor = document.body.style.cursor;
            const overlay = ensureOverlay();
            overlay.style.opacity = '0';
            document.body.style.cursor = 'crosshair';
            document.addEventListener('mousemove', handleMouseMove, true);
            document.addEventListener('click', handleClick, true);
            document.addEventListener('contextmenu', handleContextMenu, true);
            document.addEventListener('keydown', handleKeyDown, true);
          }

          function disableSelector(notifyCancel) {
            if (!selectorState.active) {
              return;
            }
            selectorState.active = false;
            selectorState.lastTarget = null;
            if (selectorState.overlay) {
              selectorState.overlay.style.opacity = '0';
              window.setTimeout(clearOverlay, 120);
            } else {
              clearOverlay();
            }
            document.body.style.cursor = selectorState.previousCursor || '';
            document.removeEventListener('mousemove', handleMouseMove, true);
            document.removeEventListener('click', handleClick, true);
            document.removeEventListener('contextmenu', handleContextMenu, true);
            document.removeEventListener('keydown', handleKeyDown, true);
            if (notifyCancel && isInIframe) {
              window.parent.postMessage({ type: 'selector-cancelled' }, '*');
            }
          }

          window.addEventListener('message', function(event) {
            const data = event.data;
            if (!data || typeof data !== 'object') {
              return;
            }
            if (data.type === 'selector-toggle') {
              if (data.active) {
                enableSelector();
              } else {
                disableSelector(false);
              }
            }
          });
        })();
      </script>
    `;
    
    if (processedHtml.includes('</body>')) {
      processedHtml = processedHtml.replace('</body>', navigationScript + '</body>');
    } else {
      processedHtml += navigationScript;
    }

    iframeRef.current.srcdoc = processedHtml;
    setActivePath(normalizedPath);
    activePathRef.current = normalizedPath;
    
    setHistoryIndex(currentIndex => {
      setNavigationHistory(currentHistory => {
        const newHistory = [...currentHistory.slice(0, currentIndex + 1), normalizedPath];
        return newHistory;
      });
      return currentIndex + 1;
    });
  };

  const handleNavigation = useCallback((path: string) => {
    loadPage(path);
  }, [compiledProject]);

  const handleBack = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      loadPage(navigationHistory[newIndex]);
    }
  };

  const handleForward = () => {
    if (historyIndex < navigationHistory.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      loadPage(navigationHistory[newIndex]);
    }
  };

  const handleHome = () => {
    loadPage('/');
  };

  const handleRefresh = () => {
    compileAndLoad(true, false);
  };


  useEffect(() => {
    const handleMessage = (event: MessageEvent<PreviewMessage>) => {
      const data = event.data;
      if (!data || typeof data !== 'object') {
        return;
      }

      if (data.type === 'navigate' && data.path) {
        handleNavigation(data.path);
        return;
      }

      if (data.type === 'selector-selection' && data.payload) {
        setSelectorActive(false);
        onFocusSelection?.(data.payload);
        return;
      }

      if (data.type === 'selector-cancelled') {
        setSelectorActive(false);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [handleNavigation, onFocusSelection]);

  useEffect(() => {
    return () => {
      if (serverRef.current) {
        serverRef.current.cleanupBlobUrls();
      }
    };
  }, []);

  if (loading) {
    return (
      <div className="h-full flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-primary" />
            <p className="text-muted-foreground">Compiling project...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-destructive space-y-2">
            <p className="font-medium">Error</p>
            <p className="text-sm mt-2">{error}</p>
            <Button onClick={handleRefresh} className="mt-4">
              Try Again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <Header />
      {/* Mobile Layout - Single row with navigation and page selector */}
      <div className="border-b p-2 flex items-center gap-2 md:hidden">
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            onClick={handleBack}
            disabled={historyIndex === 0}
          >
            <ChevronLeft className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            onClick={handleForward}
            disabled={historyIndex >= navigationHistory.length - 1}
          >
            <ChevronRight className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            onClick={handleHome}
          >
            <Home className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            onClick={handleRefresh}
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            onClick={() => setSelectorActive(prev => !prev)}
            disabled={!iframeReady}
            style={crosshairButtonStyle}
            title={selectorActive ? 'Cancel element selection' : hasFocusTarget ? 'Replace focused element' : 'Select element'}
            data-tour-id="focus-crosshair-button"
          >
            <Crosshair className="h-3 w-3" />
          </Button>
        </div>

        {/* Page selector takes remaining space */}
        {compiledProject && compiledProject.routes.length > 1 && (
          <Select value={activePath} onValueChange={handleNavigation}>
            <SelectTrigger className="flex-1 h-8 min-w-0 max-w-full">
              <SelectValue className="truncate" />
            </SelectTrigger>
            <SelectContent>
              {compiledProject.routes.map(route => (
                <SelectItem key={route.path} value={route.path}>
                  {route.title || route.path}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Desktop Layout - Single row */}
      <div className="border-b p-2 hidden md:flex items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            onClick={handleBack}
            disabled={historyIndex === 0}
          >
            <ChevronLeft className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            onClick={handleForward}
            disabled={historyIndex >= navigationHistory.length - 1}
          >
            <ChevronRight className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            onClick={handleHome}
          >
            <Home className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            onClick={handleRefresh}
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            onClick={() => setSelectorActive(prev => !prev)}
            disabled={!iframeReady}
            style={{
              backgroundColor: selectorActive ? 'var(--button-preview-active)' : undefined,
              color: selectorActive ? 'white' : undefined
            }}
            title={selectorActive ? 'Cancel element focus' : 'Select element'}
            data-tour-id="focus-crosshair-button"
          >
            <Crosshair className="h-3 w-3" />
          </Button>
        </div>

        <div className="flex-1 px-3 py-1 bg-muted rounded text-sm">
          {activePath}
        </div>

        {compiledProject && compiledProject.routes.length > 1 && (
          <Select value={activePath} onValueChange={handleNavigation}>
            <SelectTrigger className="w-[200px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {compiledProject.routes.map(route => (
                <SelectItem key={route.path} value={route.path}>
                  {route.title || route.path}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="flex items-center gap-1 border-l pl-2">
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5 rounded-sm"
            style={{
              backgroundColor: deviceSize === 'mobile' ? 'var(--button-preview-active)' : undefined,
              color: deviceSize === 'mobile' ? 'white' : undefined
            }}
            onClick={() => setDeviceSize('mobile')}
          >
            <Smartphone className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5 rounded-sm"
            style={{
              backgroundColor: deviceSize === 'tablet' ? 'var(--button-preview-active)' : undefined,
              color: deviceSize === 'tablet' ? 'white' : undefined
            }}
            onClick={() => setDeviceSize('tablet')}
          >
            <Tablet className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5 rounded-sm"
            style={{
              backgroundColor: deviceSize === 'desktop' ? 'var(--button-preview-active)' : undefined,
              color: deviceSize === 'desktop' ? 'white' : undefined
            }}
            onClick={() => setDeviceSize('desktop')}
          >
            <Monitor className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Preview Frame */}
      <div className="flex-1 bg-muted/20 dark:bg-muted/10 p-4 overflow-auto min-h-0">
        <div 
          className={cn(
            "bg-white mx-auto shadow-2xl transition-all duration-300",
            deviceSize !== 'responsive' && "rounded-lg"
          )}
          style={{
            width: DEVICE_SIZES[deviceSize].width || '100%',
            height: DEVICE_SIZES[deviceSize].height || '100%',
            maxHeight: DEVICE_SIZES[deviceSize].maxHeight || '100%',
            maxWidth: DEVICE_SIZES[deviceSize].maxWidth || '100%'
          }}
        >
          <iframe 
            ref={(el) => {
              iframeRef.current = el;
              if (el && !iframeReady) {
                // Use setTimeout to ensure iframe document is ready
                setTimeout(() => {
                  setIframeReady(true);
                }, 0);
              } else if (!el && iframeReady) {
                setIframeReady(false);
              }
            }}
            className="w-full h-full rounded-lg"
            sandbox="allow-scripts allow-same-origin allow-forms"
            title="Preview"
          />
        </div>
      </div>
    </div>
  );
}

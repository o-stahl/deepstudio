'use client';

import React, { useState, useEffect, useCallback } from 'react';
import MonacoEditor from '@monaco-editor/react';
import { VirtualFile } from '@/lib/vfs/types';
import { vfs } from '@/lib/vfs';
import { X, Code2, Save, FileCode, Image as ImageIcon, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn, logger } from '@/lib/utils';
import { useTheme } from 'next-themes';

interface MultiTabEditorProps {
  projectId: string;
  onFilesChange?: () => void;
  onClose?: () => void;
}

interface OpenFile {
  file: VirtualFile;
  content: string;
  modified: boolean;
}

export function MultiTabEditor({ projectId, onFilesChange: _onFilesChange, onClose }: MultiTabEditorProps) {
  const [openFiles, setOpenFiles] = useState<Map<string, OpenFile>>(new Map());
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const handleFileOpen = (event: CustomEvent<VirtualFile>) => {
      openFile(event.detail);
    };

    window.addEventListener('openFile', handleFileOpen as EventListener);
    
    return () => {
      window.removeEventListener('openFile', handleFileOpen as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    const handleFilesChanged = async (event: CustomEvent) => {
      if (event.detail?.fromEditor) return;
      
      setOpenFiles(prev => {
        const updateFiles = async () => {
          const updatedFiles = new Map<string, OpenFile>();
          
          for (const [path, openFile] of prev.entries()) {
            try {
              await vfs.init();
              const freshFile = await vfs.readFile(projectId, path);
              updatedFiles.set(path, {
                file: freshFile,
                content: openFile.modified ? openFile.content : freshFile.content as string,
                modified: openFile.modified
              });
            } catch {
            }
          }
          setOpenFiles(updatedFiles);
        };
        
        updateFiles();
        return prev;
      });
    };

    window.addEventListener('filesChanged', handleFilesChanged as unknown as EventListener);
    
    return () => {
      window.removeEventListener('filesChanged', handleFilesChanged as unknown as EventListener);
    };
  }, [projectId]);

  const openFile = async (file: VirtualFile) => {
    if (openFiles.has(file.path)) {
      setActiveFilePath(file.path);
      return;
    }

    const openFile: OpenFile = {
      file,
      content: file.content as string,
      modified: false
    };

    setOpenFiles(prev => new Map(prev).set(file.path, openFile));
    setActiveFilePath(file.path);
  };

  const closeFile = (path: string, event?: React.MouseEvent) => {
    if (event) {
      event.stopPropagation();
    }

    const file = openFiles.get(path);
    if (file?.modified) {
      if (!confirm(`Close ${file.file.name} without saving?`)) {
        return;
      }
    }

    setOpenFiles(prev => {
      const next = new Map(prev);
      next.delete(path);
      return next;
    });

    if (activeFilePath === path) {
      const remaining = Array.from(openFiles.keys()).filter(p => p !== path);
      setActiveFilePath(remaining.length > 0 ? remaining[remaining.length - 1] : null);
    }
  };

  const handleContentChange = useCallback((value: string | undefined, path: string) => {
    if (value === undefined) return;
    
    const fileType = getFileType(path);
    if (fileType.type !== 'text') return;

    setOpenFiles(prev => {
      const next = new Map(prev);
      const file = next.get(path);
      if (file) {
        next.set(path, {
          ...file,
          content: value,
          modified: file.file.content !== value
        });
      }
      return next;
    });
  }, []);

  const saveFile = useCallback(async (path: string) => {
    const openFile = openFiles.get(path);
    if (!openFile || !openFile.modified) return;

    try {
      await vfs.init();
      const updatedFile = await vfs.updateFile(projectId, path, openFile.content);
      
      setOpenFiles(prev => {
        const next = new Map(prev);
        next.set(path, {
          file: updatedFile,
          content: openFile.content,
          modified: false
        });
        return next;
      });

      window.dispatchEvent(new CustomEvent('fileContentChanged', { 
        detail: { path, projectId } 
      }));
    } catch (error) {
      logger.error('Failed to save file:', error);
    }
  }, [openFiles, projectId]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (activeFilePath) {
        saveFile(activeFilePath);
      }
    }
  }, [activeFilePath, saveFile]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  const getFileType = (path: string) => {
    const ext = path.split('.').pop()?.toLowerCase();
    
    if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'].includes(ext || '')) {
      return { type: 'image', language: 'plaintext' };
    }
    
    const textExtensions: Record<string, string> = {
      'js': 'javascript',
      'mjs': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'html': 'html',
      'htm': 'html',
      'css': 'css',
      'json': 'json',
      'md': 'markdown',
      'txt': 'plaintext',
      'xml': 'xml',
      'yaml': 'yaml',
      'yml': 'yaml'
    };
    
    if (textExtensions[ext || '']) {
      return { type: 'text', language: textExtensions[ext || ''] };
    }
    
    const binaryExtensions = ['zip', 'tar', 'gz', 'exe', 'bin', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
    if (binaryExtensions.includes(ext || '')) {
      return { type: 'unsupported', language: 'plaintext' };
    }
    
    return { type: 'text', language: 'plaintext' };
  };
  
  const getLanguageFromPath = (path: string): string => {
    return getFileType(path).language;
  };

  const activeFile = activeFilePath ? openFiles.get(activeFilePath) : null;

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b bg-muted/70 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Code2 
            className="h-4 w-4 md:hidden" 
            style={{ color: 'var(--button-editor-active)' }} 
          />
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Hide code editor"
              className="relative hidden h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-destructive md:flex group"
            >
              <Code2 
                className="h-4 w-4 transition-opacity group-hover:opacity-0" 
                style={{ color: 'var(--button-editor-active)' }} 
              />
              <X className="absolute h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ) : (
            <Code2 
              className="hidden h-4 w-4 md:inline-flex" 
              style={{ color: 'var(--button-editor-active)' }} 
            />
          )}
          <h3 className="text-sm font-medium">Code Editor</h3>
        </div>
        {activeFile?.modified && getFileType(activeFile.file.path).type === 'text' && (
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-2 gap-1.5"
            onClick={() => saveFile(activeFilePath!)}
          >
            <Save className="h-3 w-3" />
            <span className="text-xs">Save</span>
          </Button>
        )}
      </div>
      
      {openFiles.size === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center space-y-3">
            <FileCode className="h-12 w-12 mx-auto opacity-50" />
            <div className="space-y-1">
              <p className="text-base font-medium">No files open</p>
              <p className="text-sm">Select a file from the explorer to edit</p>
            </div>
          </div>
        </div>
      ) : (
        <>
      <div className="border-b bg-muted/70">
        <div className="flex items-center overflow-x-auto scrollbar-thin">
          {Array.from(openFiles.entries()).map(([path, file]) => (
            <div
              key={path}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 border-r cursor-pointer transition-all relative group',
                activeFilePath === path 
                  ? 'bg-background border-b-2 border-b-primary shadow-sm' 
                  : 'hover:bg-muted/50 border-b-2 border-b-transparent'
              )}
              onClick={() => setActiveFilePath(path)}
            >
              <span className="text-sm">
                {file.file.name}
                {file.modified && <span className="text-orange-500 ml-1">●</span>}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-4 w-4 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => closeFile(path, e)}
              >
                <X className="h-3 w-3 hover:text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      </div>

          {activeFile && (
            <div className="flex-1 border-t">
              {(() => {
                const fileType = getFileType(activeFile.file.path);
                
                if (fileType.type === 'image') {
                  return (
                    <div className="h-full flex items-center justify-center bg-background p-8">
                      <div className="text-center space-y-4 max-w-2xl">
                        <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground" />
                        <div className="space-y-2">
                          <h3 className="text-lg font-medium">Image Preview</h3>
                          <p className="text-sm text-muted-foreground">
                            {activeFile.file.name}
                          </p>
                        </div>
                        <div className="border rounded-lg p-4 bg-muted/30 max-h-96 overflow-auto">
                          <img 
                            src={`data:image/${activeFile.file.path.split('.').pop()};base64,${activeFile.content}`}
                            alt={activeFile.file.name}
                            className="max-w-full h-auto rounded shadow-sm"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                              const errorMsg = target.parentElement?.querySelector('.error-msg');
                              if (!errorMsg) {
                                const div = document.createElement('div');
                                div.className = 'error-msg text-sm text-muted-foreground flex items-center gap-2';
                                div.innerHTML = '<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>Unable to display image';
                                target.parentElement?.appendChild(div);
                              }
                            }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Image files cannot be edited in the text editor
                        </p>
                      </div>
                    </div>
                  );
                }
                
                if (fileType.type === 'unsupported') {
                  return (
                    <div className="h-full flex items-center justify-center bg-background p-8">
                      <div className="text-center space-y-4">
                        <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground" />
                        <div className="space-y-2">
                          <h3 className="text-lg font-medium">Unsupported File Type</h3>
                          <p className="text-sm text-muted-foreground">
                            {activeFile.file.name}
                          </p>
                          <p className="text-sm text-muted-foreground max-w-md">
                            This file type is not supported for editing in the text editor.
                            Binary files and certain document formats cannot be displayed here.
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                }
                
                return (
                  <MonacoEditor
                    height="100%"
                    language={getLanguageFromPath(activeFile.file.path)}
                    value={activeFile.content}
                    onChange={(value) => handleContentChange(value, activeFile.file.path)}
                    theme={mounted ? (resolvedTheme === 'dark' ? 'vs-dark' : 'light') : 'vs-dark'}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 14,
                      lineNumbers: 'on',
                      roundedSelection: false,
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      tabSize: 2,
                      wordWrap: 'on',
                      wrappingIndent: 'indent'
                    }}
                  />
                );
              })()}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function openFileInEditor(file: VirtualFile) {
  window.dispatchEvent(new CustomEvent('openFile', { detail: file }));
}

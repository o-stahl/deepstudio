'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { VirtualFile, isFileSupported, FILE_SIZE_LIMITS, getFileTypeFromPath } from '@/lib/vfs/types';
import { vfs } from '@/lib/vfs';
import { logger, cn } from '@/lib/utils';
import { 
  ChevronRight, 
  ChevronDown, 
  File, 
  Folder, 
  FolderOpen,
  FolderTree,
  Upload,
  Image,
  Video,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

interface FileExplorerProps {
  projectId: string;
  onFileSelect?: (file: VirtualFile) => void;
  selectedPath?: string;
  onClose?: () => void;
}

interface FileTreeItem {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: FileTreeItem[];
}

export function FileExplorer({ projectId, onFileSelect, selectedPath, onClose }: FileExplorerProps) {
  const [files, setFiles] = useState<VirtualFile[]>([]);
  const [fileTree, setFileTree] = useState<FileTreeItem[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['/']));
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [draggedItem, setDraggedItem] = useState<FileTreeItem | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async () => {
    try {
      await vfs.init();
      const allItems = await vfs.getAllFilesAndDirectories(projectId);
      const projectFiles = allItems.filter(item => item.type !== 'directory') as VirtualFile[];
      setFiles(projectFiles);
      setFileTree(buildFileTree(allItems));
    } catch (error) {
      logger.error('Failed to load files:', error);
    }
  }, [projectId]);

  useEffect(() => {
    loadFiles();
    
    const handleFilesChanged = () => {
      loadFiles();
    };
    
    window.addEventListener('filesChanged', handleFilesChanged);
    
    return () => {
      window.removeEventListener('filesChanged', handleFilesChanged);
    };
  }, [projectId, loadFiles]);

  const buildFileTree = (items: Array<VirtualFile | { path: string; name: string; type: 'directory' }>): FileTreeItem[] => {
    const tree: FileTreeItem[] = [];
    const dirMap = new Map<string, FileTreeItem>();

    items.forEach(item => {
      if (item.type === 'directory') {
        const parts = item.path.split('/').filter(Boolean);
        const dirItem: FileTreeItem = {
          path: item.path,
          name: item.name || parts[parts.length - 1] || 'unnamed',
          type: 'directory',
          children: []
        };
        dirMap.set(item.path, dirItem);
      }
    });

    items.forEach(item => {
      if (item.type !== 'directory') {
        const parts = item.path.split('/').filter(Boolean);
        let currentPath = '';
        
        for (let i = 0; i < parts.length - 1; i++) {
          currentPath = currentPath + '/' + parts[i];
          
          if (!dirMap.has(currentPath)) {
            const dir: FileTreeItem = {
              path: currentPath,
              name: parts[i],
              type: 'directory',
              children: []
            };
            dirMap.set(currentPath, dir);
          }
        }
      }
    });

    dirMap.forEach((dir, path) => {
      const parts = path.split('/').filter(Boolean);
      if (parts.length === 1) {
        tree.push(dir);
      } else {
        const parentPath = '/' + parts.slice(0, -1).join('/');
        const parent = dirMap.get(parentPath);
        if (parent && parent.children) {
          parent.children.push(dir);
        }
      }
    });

    items.forEach(item => {
      if (item.type !== 'directory') {
        const file = item as VirtualFile;
        const parts = file.path.split('/').filter(Boolean);
        const fileItem: FileTreeItem = {
          path: file.path,
          name: file.name,
          type: 'file'
        };

        if (parts.length === 1) {
          tree.push(fileItem);
        } else {
          const dirPath = '/' + parts.slice(0, -1).join('/');
          const dir = dirMap.get(dirPath);
          if (dir) {
            dir.children?.push(fileItem);
          }
        }
      }
    });

    const sortItems = (items: FileTreeItem[]) => {
      items.sort((a, b) => {
        if (a.type === b.type) {
          return a.name.localeCompare(b.name);
        }
        return a.type === 'directory' ? -1 : 1;
      });
      items.forEach(item => {
        if (item.children) {
          sortItems(item.children);
        }
      });
    };

    sortItems(tree);
    return tree;
  };

  const toggleDirectory = (path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleFileClick = async (item: FileTreeItem) => {
    if (item.type === 'directory') {
      toggleDirectory(item.path);
    } else {
      const file = files.find(f => f.path === item.path);
      if (file && onFileSelect) {
        onFileSelect(file);
      }
    }
  };

  const handleCreateFile = async (dirPath: string = '/') => {
    const fileName = prompt('Enter file name:');
    if (!fileName) return;

    const filePath = dirPath === '/' ? `/${fileName}` : `${dirPath}/${fileName}`;
    
    try {
      await vfs.createFile(projectId, filePath, '');
      await loadFiles();
    } catch (error) {
      logger.error('Failed to create file:', error);
    }
  };

  const handleCreateDirectory = async (parentPath: string = '/') => {
    const dirName = prompt('Enter directory name:');
    if (!dirName) return;

    const dirPath = parentPath === '/' ? `/${dirName}` : `${parentPath}/${dirName}`;
    
    try {
      await vfs.createDirectory(projectId, dirPath);
      await loadFiles();
    } catch (error) {
      logger.error('Failed to create directory:', error);
    }
  };

  const handleDelete = async (path: string, type: 'file' | 'directory') => {
    if (!confirm(`Delete ${type} "${path}"?`)) return;

    try {
      if (type === 'file') {
        await vfs.deleteFile(projectId, path);
      } else {
        await vfs.deleteDirectory(projectId, path);
      }
      await loadFiles();
    } catch (error) {
      logger.error(`Failed to delete ${type}:`, error);
    }
  };

  const handleRename = async (oldPath: string, itemType: 'file' | 'directory') => {
    if (!newName) return;

    const parts = oldPath.split('/');
    parts[parts.length - 1] = newName;
    const newPath = parts.join('/');

    try {
      if (itemType === 'directory') {
        await vfs.renameDirectory(projectId, oldPath, newPath);
      } else {
        await vfs.renameFile(projectId, oldPath, newPath);
      }
      await loadFiles();
      setRenamingPath(null);
      setNewName('');
    } catch (error) {
      logger.error(`Failed to rename ${itemType}:`, error);
    }
  };

  const handleFileDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    const items = Array.from(e.dataTransfer.items);
    
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          await uploadFile(file, '/');
        }
      }
    }
  };

  const uploadFile = async (file: File, targetDir: string) => {
    if (!isFileSupported(file.name)) {
      toast.error(`File type not supported: ${file.name}`);
      return;
    }

    const fileType = getFileTypeFromPath(file.name);
    const sizeLimit = FILE_SIZE_LIMITS[fileType];
    if (file.size > sizeLimit) {
      toast.error(`File too large: ${file.name}. Maximum size is ${Math.round(sizeLimit / 1024 / 1024)}MB`);
      return;
    }

    const filePath = targetDir === '/' ? `/${file.name}` : `${targetDir}/${file.name}`;

    try {
      let content: string | ArrayBuffer;
      
      if (fileType === 'image' || fileType === 'video' || fileType === 'binary') {
        content = await file.arrayBuffer();
      } else {
        content = await file.text();
      }

      await vfs.createFile(projectId, filePath, content);
      await loadFiles();
      toast.success(`Uploaded ${file.name}`);
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        if (confirm(`File "${file.name}" already exists. Overwrite?`)) {
          try {
            await vfs.deleteFile(projectId, filePath);
            await uploadFile(file, targetDir); // Retry
          } catch (deleteError) {
            logger.error('Failed to overwrite file:', deleteError);
            toast.error('Failed to overwrite file');
          }
        }
      } else {
        logger.error('Failed to upload file:', error);
        toast.error(`Failed to upload ${file.name}: ${error.message}`);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
      setIsDraggingOver(false);
    }
  };

  const handleItemDragStart = (e: React.DragEvent, item: FileTreeItem) => {
    e.stopPropagation();
    setDraggedItem(item);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleItemDragEnd = () => {
    setDraggedItem(null);
    setDropTarget(null);
  };

  const handleItemDragOver = (e: React.DragEvent, targetPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (draggedItem && targetPath !== draggedItem.path) {
      e.dataTransfer.dropEffect = 'move';
      setDropTarget(targetPath);
    }
  };

  const handleItemDrop = async (e: React.DragEvent, targetItem: FileTreeItem | null) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedItem) {
      setDropTarget(null);
      return;
    }

    if (targetItem && draggedItem.path === targetItem.path) {
      setDropTarget(null);
      return;
    }

    const targetDir = targetItem ? (targetItem.type === 'directory' ? targetItem.path : '/') : '/';
    
    if (draggedItem.type === 'directory') {
      const draggedDirPath = draggedItem.path.endsWith('/') ? draggedItem.path : draggedItem.path + '/';
      const targetDirPath = targetDir.endsWith('/') ? targetDir : targetDir + '/';
      
      if (targetDirPath.startsWith(draggedDirPath)) {
        toast.error('Cannot move a folder into itself');
        setDropTarget(null);
        return;
      }
    }

    const fileName = draggedItem.name;
    const newPath = targetDir === '/' ? `/${fileName}` : `${targetDir}/${fileName}`;

    try {
      if (draggedItem.type === 'directory') {
        await vfs.moveDirectory(projectId, draggedItem.path, newPath);
      } else {
        await vfs.moveFile(projectId, draggedItem.path, newPath);
      }
      await loadFiles();
      toast.success(`Moved ${draggedItem.name} to ${targetDir === '/' ? 'root' : targetDir}`);
    } catch (error: any) {
      logger.error('Failed to move item:', error);
      toast.error(`Failed to move: ${error.message}`);
    }
    
    setDropTarget(null);
  };

  const renderTreeItem = (item: FileTreeItem, level: number = 0) => {
    const isExpanded = expandedDirs.has(item.path);
    const isSelected = selectedPath === item.path;
    const isRenaming = renamingPath === item.path;
    const isDropTarget = dropTarget === item.path;

    return (
      <div 
        key={item.path}
        draggable={!isRenaming}
        onDragStart={(e) => handleItemDragStart(e, item)}
        onDragEnd={handleItemDragEnd}
        onDragOver={(e) => item.type === 'directory' && handleItemDragOver(e, item.path)}
        onDrop={(e) => item.type === 'directory' && handleItemDrop(e, item)}
      >
        <ContextMenu>
          <ContextMenuTrigger>
            <div
            className={cn(
              'flex items-center gap-2 px-2 py-1.5 hover:bg-accent hover:text-accent-foreground cursor-pointer rounded-md transition-colors',
              isSelected && 'bg-accent text-accent-foreground',
              isDropTarget && item.type === 'directory' && 'bg-blue-500/20 border border-blue-500',
              draggedItem?.path === item.path && 'opacity-50',
              'group'
            )}
            style={{ paddingLeft: `${level * 16 + 8}px` }}
            onClick={() => handleFileClick(item)}
          >
            {item.type === 'directory' ? (
              <>
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                )}
                {isExpanded ? (
                  <FolderOpen className="w-4 h-4 text-blue-500" />
                ) : (
                  <Folder className="w-4 h-4 text-blue-500" />
                )}
              </>
            ) : (
              <>
                <span className="w-4" />
                {(() => {
                  const fileType = getFileTypeFromPath(item.path);
                  if (fileType === 'image') {
                    return <Image className="w-4 h-4 text-green-500" />;
                  } else if (fileType === 'video') {
                    return <Video className="w-4 h-4 text-purple-500" />;
                  } else {
                    return <File className="w-4 h-4 text-muted-foreground" />;
                  }
                })()}
              </>
            )}
            {isRenaming ? (
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onBlur={() => handleRename(item.path, item.type)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleRename(item.path, item.type);
                  } else if (e.key === 'Escape') {
                    setRenamingPath(null);
                    setNewName('');
                  }
                }}
                className="h-5 text-sm"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="text-sm flex-1">{item.name}</span>
            )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
          {item.type === 'directory' && (
            <>
              <ContextMenuItem onClick={() => handleCreateFile(item.path)}>
                <File className="mr-2 h-4 w-4" />
                New File
              </ContextMenuItem>
              <ContextMenuItem onClick={() => handleCreateDirectory(item.path)}>
                <Folder className="mr-2 h-4 w-4" />
                New Folder
              </ContextMenuItem>
              <ContextMenuItem onClick={() => fileInputRef.current?.click()}>
                <Upload className="mr-2 h-4 w-4" />
                Upload Files
              </ContextMenuItem>
            </>
          )}
          <ContextMenuItem onClick={() => {
            setRenamingPath(item.path);
            setNewName(item.name);
          }}>
            Rename
          </ContextMenuItem>
          <ContextMenuItem 
            onClick={() => handleDelete(item.path, item.type)}
            className="text-destructive"
          >
            Delete
          </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {item.type === 'directory' && isExpanded && item.children && (
          <div>
            {item.children.map(child => renderTreeItem(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div 
      className="h-full flex flex-col"
      onDrop={handleFileDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={async (e) => {
          const files = Array.from(e.target.files || []);
          for (const file of files) {
            await uploadFile(file, '/');
          }
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
        }}
      />
      <div className="p-3 border-b bg-muted/70 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderTree 
            className="h-4 w-4 md:hidden" 
            style={{ color: 'var(--button-files-active)' }} 
          />
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Hide file explorer"
              className="relative hidden h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-destructive md:flex group"
            >
              <FolderTree 
                className="h-4 w-4 transition-opacity group-hover:opacity-0" 
                style={{ color: 'var(--button-files-active)' }} 
              />
              <X className="absolute h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ) : (
            <FolderTree 
              className="hidden h-4 w-4 md:inline-flex" 
              style={{ color: 'var(--button-files-active)' }} 
            />
          )}
          <h3 className="text-sm font-medium">File Explorer</h3>
        </div>
        <div className="flex gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            onClick={() => fileInputRef.current?.click()}
            title="Upload files"
          >
            <Upload className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            onClick={() => handleCreateFile('/')}
            title="New file"
          >
            <File className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            onClick={() => handleCreateDirectory('/')}
            title="New folder"
          >
            <Folder className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div 
            className={cn(
              "flex-1 overflow-y-auto p-3 space-y-0.5 relative",
              isDraggingOver && "bg-blue-500/10"
            )}
            onDragOver={(e) => {
              if (draggedItem) {
                e.preventDefault();
                e.stopPropagation();
                setDropTarget('/');
              }
            }}
            onDrop={(e) => {
              if (draggedItem) {
                handleItemDrop(e, null);
              }
            }}
          >
            {isDraggingOver && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-blue-500/20 border-2 border-dashed border-blue-500 rounded-lg p-8">
                  <Upload className="h-12 w-12 text-blue-500 mx-auto mb-2" />
                  <p className="text-sm text-blue-600">Drop files here to upload</p>
                </div>
              </div>
            )}
            {fileTree.length === 0 ? (
              <div className="flex-1 flex items-center justify-center py-8">
                <div className="text-center space-y-3">
                  <Folder className="h-12 w-12 mx-auto opacity-50 text-muted-foreground" />
                  <div className="space-y-1">
                    <p className="text-base font-medium text-foreground">No files yet</p>
                    <p className="text-sm text-muted-foreground">Create your first file to get started</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="contents">
                {fileTree.map(item => renderTreeItem(item))}
              </div>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => handleCreateFile('/')}>
            <File className="mr-2 h-4 w-4" />
            New File
          </ContextMenuItem>
          <ContextMenuItem onClick={() => handleCreateDirectory('/')}>
            <Folder className="mr-2 h-4 w-4" />
            New Folder
          </ContextMenuItem>
          <ContextMenuItem onClick={() => fileInputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" />
            Upload Files
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

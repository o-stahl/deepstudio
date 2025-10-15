'use client';

import React from 'react';
import { CustomTemplate, LICENSE_OPTIONS } from '@/lib/vfs/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus, FileBox, Download, Link2, ExternalLink, MoreVertical } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface BuiltInTemplate {
  id: string;
  name: string;
  description: string;
  isBuiltIn: true;
  updatedAt: Date;
  metadata?: {
    author?: string;
    tags?: string[];
  };
}

interface TemplateCardProps {
  template: CustomTemplate | BuiltInTemplate;
  onSelect: (template: CustomTemplate | BuiltInTemplate) => void;
  onDelete?: (id: string) => void;
  onExport?: (template: CustomTemplate | BuiltInTemplate) => void;
  viewMode?: 'grid' | 'list';
}

export function TemplateCard({
  template,
  onSelect,
  onDelete,
  onExport,
  viewMode = 'grid'
}: TemplateCardProps) {
  const isBuiltIn = 'isBuiltIn' in template && template.isBuiltIn;
  const customTemplate = !isBuiltIn ? template as CustomTemplate : null;

  const getLicenseLabel = (licenseValue: string): string => {
    const license = LICENSE_OPTIONS.find(opt => opt.value === licenseValue);
    return license?.label || licenseValue;
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isBuiltIn || !onDelete) return;
    onDelete(template.id);
  };

  const handleExport = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onExport) onExport(template);
  };

  const formatDate = (date: Date | undefined) => {
    if (!date) return 'Never';
    try {
      return formatDistanceToNow(date, { addSuffix: true });
    } catch {
      return 'Recently';
    }
  };

  // List view (horizontal row)
  if (viewMode === 'list') {
    return (
      <div
        className="border border-border rounded-lg p-4 bg-card"
      >
        <div className="flex items-center gap-4">
          {/* Thumbnail */}
          <div className="relative shrink-0">
            {customTemplate?.metadata.thumbnail ? (
              <div className="w-24 h-16 rounded-md overflow-hidden bg-muted">
                <img
                  src={customTemplate.metadata.thumbnail}
                  alt={template.name}
                  className="w-full h-full object-cover"
                />
              </div>
            ) : (
              <div className="w-24 h-16 rounded-md bg-muted flex items-center justify-center">
                <FileBox className="h-8 w-8 text-muted-foreground" />
              </div>
            )}
            {isBuiltIn && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="absolute top-1 right-1 bg-background/90 rounded-full p-1">
                      <Link2 className="h-3 w-3 text-muted-foreground" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>Built-in template</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>

          {/* Template Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 mb-1">
              <h3 className="font-semibold text-base truncate" title={template.name}>
                {template.name}
              </h3>
              {customTemplate && (
                <span className="text-xs text-muted-foreground shrink-0">
                  v{customTemplate.version}
                </span>
              )}
            </div>

            <p className="text-sm text-muted-foreground line-clamp-1 mb-2" title={template.description}>
              {template.description}
            </p>

            {/* Metadata */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {(customTemplate?.metadata.author || template.metadata?.author) && (
                <span className="truncate max-w-[150px]" title={customTemplate?.metadata.author || template.metadata?.author}>
                  by {customTemplate?.metadata.author || template.metadata?.author}
                </span>
              )}
              {customTemplate?.metadata.license && (
                <>
                  {customTemplate.metadata.author && <span>•</span>}
                  <Badge variant="secondary" className="text-xs px-1.5 py-0 h-auto">
                    {getLicenseLabel(customTemplate.metadata.license)}
                  </Badge>
                </>
              )}
              {customTemplate?.files && (
                <>
                  <span>•</span>
                  <span>{customTemplate.files.length} files</span>
                </>
              )}
              {(customTemplate?.metadata.tags || template.metadata?.tags) && (
                <>
                  <span>•</span>
                  {(customTemplate?.metadata.tags || template.metadata?.tags || []).slice(0, 2).map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs px-1.5 py-0 h-auto">
                      {tag}
                    </Badge>
                  ))}
                  {(customTemplate?.metadata.tags || template.metadata?.tags || []).length > 2 && (
                    <Badge variant="outline" className="text-xs px-1.5 py-0 h-auto">
                      +{(customTemplate?.metadata.tags || template.metadata?.tags || []).length - 2}
                    </Badge>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Actions - Desktop */}
          <div className="hidden md:flex items-center gap-3 shrink-0">
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {formatDate(customTemplate?.updatedAt || template.updatedAt)}
            </span>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-8 w-8">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onSelect(template)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Project
                </DropdownMenuItem>
                {onExport && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleExport}>
                      <Download className="mr-2 h-4 w-4" />
                      Export Template
                    </DropdownMenuItem>
                  </>
                )}
                {onDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={handleDelete}
                              disabled={isBuiltIn}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </div>
                        </TooltipTrigger>
                        {isBuiltIn && (
                          <TooltipContent>Built-in templates cannot be deleted</TooltipContent>
                        )}
                      </Tooltip>
                    </TooltipProvider>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Actions - Mobile */}
          <div className="md:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-8 w-8">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onSelect(template)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Project
                </DropdownMenuItem>
                {onExport && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleExport}>
                      <Download className="mr-2 h-4 w-4" />
                      Export Template
                    </DropdownMenuItem>
                  </>
                )}
                {onDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={handleDelete}
                      disabled={isBuiltIn}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    );
  }

  // Grid view (vertical card)
  return (
    <div
      className="border border-border rounded-lg overflow-hidden bg-card group"
    >
      {/* Thumbnail */}
      <div className="relative">
        {customTemplate?.metadata.thumbnail ? (
          <div className="w-full aspect-video bg-muted">
            <img
              src={customTemplate.metadata.thumbnail}
              alt={template.name}
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className="w-full aspect-video bg-muted flex items-center justify-center">
            <FileBox className="h-16 w-16 text-muted-foreground" />
          </div>
        )}
        {isBuiltIn && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="absolute top-2 right-2 bg-background/90 rounded-full p-1.5 shadow-sm">
                  <Link2 className="h-4 w-4 text-muted-foreground" />
                </div>
              </TooltipTrigger>
              <TooltipContent>Built-in template</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {customTemplate?.metadata.downloadUrl && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={customTemplate.metadata.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute top-2 left-2 bg-background/90 hover:bg-background rounded-full p-1.5 shadow-sm transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                </a>
              </TooltipTrigger>
              <TooltipContent>View on marketplace</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-baseline gap-2">
            <h3 className="font-semibold text-base line-clamp-1 flex-1" title={template.name}>
              {template.name}
            </h3>
            {customTemplate && (
              <span className="text-xs text-muted-foreground shrink-0">
                v{customTemplate.version}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground line-clamp-2" title={template.description}>
            {template.description}
          </p>
        </div>

        {/* Metadata */}
        <div className="space-y-2">
          {(customTemplate?.metadata.author || template.metadata?.author) && (
            <div className="text-xs text-muted-foreground">
              {customTemplate?.metadata.authorUrl ? (
                <a
                  href={customTemplate.metadata.authorUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  by {customTemplate.metadata.author}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span>by {customTemplate?.metadata.author || template.metadata?.author}</span>
              )}
            </div>
          )}

          {/* Tags */}
          {(customTemplate?.metadata.tags || template.metadata?.tags) && (customTemplate?.metadata.tags || template.metadata?.tags || []).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {(customTemplate?.metadata.tags || template.metadata?.tags || []).slice(0, 3).map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs px-1.5 py-0.5">
                  {tag}
                </Badge>
              ))}
              {(customTemplate?.metadata.tags || template.metadata?.tags || []).length > 3 && (
                <Badge variant="secondary" className="text-xs px-1.5 py-0.5">
                  +{(customTemplate?.metadata.tags || template.metadata?.tags || []).length - 3}
                </Badge>
              )}
            </div>
          )}

          {/* License and file count */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            {customTemplate?.metadata.license && (
              <Badge variant="outline" className="text-xs px-1.5 py-0 h-auto">
                {getLicenseLabel(customTemplate.metadata.license)}
              </Badge>
            )}
            {customTemplate?.files && (
              <>
                {customTemplate.metadata.license && <span>•</span>}
                <span>{customTemplate.files.length} files</span>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="pt-3 border-t flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {formatDate(customTemplate?.updatedAt || template.updatedAt)}
          </span>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onSelect(template)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Project
              </DropdownMenuItem>
              {onExport && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleExport}>
                    <Download className="mr-2 h-4 w-4" />
                    Export Template
                  </DropdownMenuItem>
                </>
              )}
              {onDelete && (
                <>
                  <DropdownMenuSeparator />
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={handleDelete}
                            disabled={isBuiltIn}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </div>
                      </TooltipTrigger>
                      {isBuiltIn && (
                        <TooltipContent>Built-in templates cannot be deleted</TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

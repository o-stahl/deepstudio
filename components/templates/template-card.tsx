'use client';

import React from 'react';
import { CustomTemplate, LICENSE_OPTIONS } from '@/lib/vfs/types';
import { Button } from '@/components/ui/button';
import { Eye, Trash2, Plus, FileBox } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface TemplateCardProps {
  template: CustomTemplate | {
    id: string;
    name: string;
    description: string;
    isBuiltIn: true;
  };
  isBuiltIn?: boolean;
  onSelect: (template: CustomTemplate | any) => void;
  onDelete?: (id: string) => void;
  onPreview?: (template: CustomTemplate) => void;
  compact?: boolean;
}

export function TemplateCard({
  template,
  isBuiltIn = false,
  onSelect,
  onDelete,
  onPreview,
  compact = false
}: TemplateCardProps) {
  const isCustomTemplate = !isBuiltIn && 'metadata' in template;
  const customTemplate = isCustomTemplate ? template as CustomTemplate : null;

  const getLicenseLabel = (licenseValue: string): string => {
    const license = LICENSE_OPTIONS.find(opt => opt.value === licenseValue);
    return license?.label || licenseValue;
  };

  // Horizontal row layout (default)
  if (!compact) {
    return (
      <div className="group relative border rounded-lg p-4 hover:border-primary/50 hover:shadow-md transition-all bg-card">
        <div className="flex flex-col sm:flex-row gap-4 items-start">
          {/* Thumbnail */}
          {customTemplate?.metadata.thumbnail ? (
            <div className="w-full sm:w-28 h-24 shrink-0 rounded-md overflow-hidden bg-muted">
              <img
                src={customTemplate.metadata.thumbnail}
                alt={template.name}
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="w-full sm:w-28 h-24 shrink-0 rounded-md bg-muted flex items-center justify-center">
              <FileBox className="h-10 w-10 text-muted-foreground" />
            </div>
          )}

          {/* Template Info */}
          <div className="flex-1 min-w-0 space-y-3 w-full">
            {/* Title and Version */}
            <div className="space-y-1">
              <div className="flex items-baseline gap-2">
                <h3 className="font-semibold text-base line-clamp-2" title={template.name}>
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

            {/* Metadata Row */}
            {customTemplate && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {customTemplate.metadata.author && (
                  <span className="truncate max-w-[150px]" title={customTemplate.metadata.author}>
                    by {customTemplate.metadata.author}
                  </span>
                )}
                {customTemplate.metadata.license && (
                  <>
                    {customTemplate.metadata.author && <span>•</span>}
                    <span className="truncate max-w-[120px]" title={getLicenseLabel(customTemplate.metadata.license)}>
                      {getLicenseLabel(customTemplate.metadata.license)}
                    </span>
                  </>
                )}
                {customTemplate.files && (
                  <>
                    <span>•</span>
                    <span>{customTemplate.files.length} files</span>
                  </>
                )}

                {/* Tags */}
                {customTemplate.metadata.tags && customTemplate.metadata.tags.length > 0 && (
                  <>
                    <span>•</span>
                    {customTemplate.metadata.tags.slice(0, 3).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs px-1.5 py-0 h-auto">
                        {tag}
                      </Badge>
                    ))}
                    {customTemplate.metadata.tags.length > 3 && (
                      <Badge variant="secondary" className="text-xs px-1.5 py-0 h-auto">
                        +{customTemplate.metadata.tags.length - 3}
                      </Badge>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Actions - Desktop */}
            <div className="hidden md:flex gap-2">
              <Button
                onClick={() => onSelect(template)}
                size="sm"
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Create Project
              </Button>

              {customTemplate && (
                <>
                  {onPreview && (
                    <Button
                      onClick={() => onPreview(customTemplate)}
                      size="sm"
                      variant="outline"
                    >
                      <Eye className="h-3.5 w-3.5 mr-1.5" />
                      Preview
                    </Button>
                  )}
                  {onDelete && (
                    <Button
                      onClick={() => onDelete(customTemplate.id)}
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </>
              )}
            </div>

            {/* Actions - Mobile/Tablet */}
            <div className="flex md:hidden gap-2">
              <Button
                onClick={() => onSelect(template)}
                size="sm"
                className="flex-1 min-h-[44px]"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Create Project
              </Button>

              {customTemplate && (
                <>
                  {onPreview && (
                    <Button
                      onClick={() => onPreview(customTemplate)}
                      size="sm"
                      variant="outline"
                      className="min-h-[44px] min-w-[44px]"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  )}
                  {onDelete && (
                    <Button
                      onClick={() => onDelete(customTemplate.id)}
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 min-h-[44px] min-w-[44px]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Compact vertical card layout (for tight spaces)
  return (
    <div className="group relative border rounded-lg p-4 hover:border-primary/50 transition-colors bg-card">
      {/* Thumbnail */}
      {customTemplate?.metadata.thumbnail ? (
        <div className="w-full h-32 mb-3 rounded-md overflow-hidden bg-muted">
          <img
            src={customTemplate.metadata.thumbnail}
            alt={template.name}
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <div className="w-full h-32 mb-3 rounded-md bg-muted flex items-center justify-center">
          <FileBox className="h-12 w-12 text-muted-foreground" />
        </div>
      )}

      {/* Template Info */}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-sm line-clamp-1" title={template.name}>
            {template.name}
          </h3>
          {customTemplate && (
            <span className="text-xs text-muted-foreground shrink-0">
              v{customTemplate.version}
            </span>
          )}
        </div>

        <p className="text-xs text-muted-foreground line-clamp-2" title={template.description}>
          {template.description}
        </p>

        {/* Metadata */}
        {customTemplate && (
          <div className="flex flex-wrap gap-1 items-center text-xs text-muted-foreground">
            {customTemplate.metadata.author && (
              <span className="line-clamp-1">by {customTemplate.metadata.author}</span>
            )}
            {customTemplate.metadata.author && customTemplate.metadata.license && (
              <span>•</span>
            )}
            {customTemplate.metadata.license && (
              <span className="line-clamp-1">{getLicenseLabel(customTemplate.metadata.license)}</span>
            )}
          </div>
        )}

        {/* Tags */}
        {customTemplate?.metadata.tags && customTemplate.metadata.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {customTemplate.metadata.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs px-1.5 py-0">
                {tag}
              </Badge>
            ))}
            {customTemplate.metadata.tags.length > 3 && (
              <Badge variant="secondary" className="text-xs px-1.5 py-0">
                +{customTemplate.metadata.tags.length - 3}
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 mt-4 flex-col sm:flex-row">
        <Button
          onClick={() => onSelect(template)}
          size="sm"
          className="flex-1"
        >
          <Plus className="h-3 w-3 mr-1.5" />
          Create Project
        </Button>

        {customTemplate && (
          <>
            {onPreview && (
              <Button
                onClick={() => onPreview(customTemplate)}
                size="sm"
                variant="outline"
                className="shrink-0"
              >
                <Eye className="h-3 w-3" />
                <span className="sr-only sm:not-sr-only sm:ml-1.5">
                  Preview
                </span>
              </Button>
            )}
            {onDelete && (
              <Button
                onClick={() => onDelete(customTemplate.id)}
                size="sm"
                variant="outline"
                className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-3 w-3" />
                <span className="sr-only">Delete</span>
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

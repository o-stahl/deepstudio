'use client';

import React from 'react';
import { CustomTemplate, LICENSE_OPTIONS } from '@/lib/vfs/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ExternalLink, FileBox } from 'lucide-react';

interface TemplatePreviewDialogProps {
  template: CustomTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm?: () => void;
}

export function TemplatePreviewDialog({
  template,
  open,
  onOpenChange,
  onConfirm
}: TemplatePreviewDialogProps) {
  if (!template) return null;

  const getLicenseLabel = (licenseValue?: string): string => {
    if (!licenseValue) return 'Unknown';
    const license = LICENSE_OPTIONS.find(opt => opt.value === licenseValue);
    return license?.label || (template as any).metadata?.licenseLabel || licenseValue;
  };

  const getLicenseDescription = (licenseValue?: string): string | undefined => {
    if (!licenseValue) return undefined;
    const license = LICENSE_OPTIONS.find(opt => opt.value === licenseValue);
    return license?.description || (template as any).metadata?.licenseDescription;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template.name}</DialogTitle>
          <DialogDescription>
            {(template as any).version && `Version ${(template as any).version}`}
            {(template as any).metadata?.author && ` by ${(template as any).metadata.author}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Preview Image */}
          {(template as any).metadata?.thumbnail ? (
            <div className="w-full rounded-lg overflow-hidden bg-muted border">
              <img
                src={(template as any).metadata.thumbnail}
                alt={template.name}
                className="w-full h-auto"
              />
            </div>
          ) : (
            <div className="w-full h-48 rounded-lg bg-muted flex items-center justify-center border">
              <FileBox className="h-16 w-16 text-muted-foreground" />
            </div>
          )}

          {/* Additional Preview Images */}
          {(template as any).metadata?.previewImages && (template as any).metadata.previewImages.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {(template as any).metadata.previewImages.map((img: string, idx: number) => (
                <div key={idx} className="rounded-md overflow-hidden bg-muted border">
                  <img
                    src={img}
                    alt={`Preview ${idx + 1}`}
                    className="w-full h-auto"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Description */}
          <div>
            <h3 className="font-semibold mb-2">Description</h3>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {template.description}
            </p>
          </div>

          {/* Metadata Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            {/* License */}
            {(template as any).metadata?.license && (
              <div>
                <h4 className="font-medium mb-1">License</h4>
                <div className="space-y-1">
                  <p className="text-muted-foreground">{getLicenseLabel((template as any).metadata.license)}</p>
                  {getLicenseDescription((template as any).metadata.license) && (
                    <p className="text-xs text-muted-foreground italic">
                      {getLicenseDescription((template as any).metadata.license)}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Author */}
            {(template as any).metadata?.author && (
              <div>
                <h4 className="font-medium mb-1">Author</h4>
                {(template as any).metadata.authorUrl ? (
                  <a
                    href={(template as any).metadata.authorUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline flex items-center gap-1"
                  >
                    {(template as any).metadata.author}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <p className="text-muted-foreground">{(template as any).metadata.author}</p>
                )}
              </div>
            )}

            {/* File Count */}
            {(template as any).files && (
              <div>
                <h4 className="font-medium mb-1">Files</h4>
                <p className="text-muted-foreground">{(template as any).files.length} files</p>
              </div>
            )}

            {/* Directories */}
            {(template as any).directories && (
              <div>
                <h4 className="font-medium mb-1">Directories</h4>
                <p className="text-muted-foreground">{(template as any).directories.length} directories</p>
              </div>
            )}
          </div>

          {/* Tags */}
          {(template as any).metadata?.tags && (template as any).metadata.tags.length > 0 && (
            <div>
              <h4 className="font-medium mb-2">Tags</h4>
              <div className="flex flex-wrap gap-2">
                {(template as any).metadata.tags.map((tag: string) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Download URL */}
          {(template as any).metadata?.downloadUrl && (
            <div>
              <h4 className="font-medium mb-1">Marketplace</h4>
              <a
                href={(template as any).metadata.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline flex items-center gap-1"
              >
                View on marketplace
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {onConfirm && (
            <Button onClick={onConfirm}>
              Import Template
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import React from 'react';
import { Check, X, Loader2, Clock, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type TaskStatus = 'pending' | 'in_progress' | 'success' | 'failed' | 'skipped';

export interface TaskStep {
  id: string;
  description: string;
  status: TaskStatus;
  error?: string;
  timestamp?: string;
}

export interface TaskProgressProps {
  title: string;
  steps: TaskStep[];
  checkpointId?: string;
  onRestore?: (checkpointId: string) => void;
  isSavedCheckpoint?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

const statusIcons: Record<TaskStatus, React.ReactNode> = {
  pending: <Clock className="h-4 w-4 text-muted-foreground" />,
  in_progress: <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />,
  success: <Check className="h-4 w-4 text-green-500" />,
  failed: <X className="h-4 w-4 text-red-500" />,
  skipped: <span className="text-muted-foreground">⊘</span>,
};

const statusColors: Record<TaskStatus, string> = {
  pending: 'text-muted-foreground',
  in_progress: 'text-blue-500',
  success: 'text-green-500',
  failed: 'text-red-500',
  skipped: 'text-gray-400',
};

export function TaskProgressDisplay({
  title,
  steps,
  checkpointId,
  onRestore,
  isSavedCheckpoint,
  expanded = true,
  onToggleExpand,
}: TaskProgressProps) {
  const completedCount = steps.filter(s => s.status === 'success').length;
  const failedCount = steps.filter(s => s.status === 'failed').length;
  const inProgress = steps.some(s => s.status === 'in_progress');
  const allDone = steps.every(s => s.status !== 'pending' && s.status !== 'in_progress');

  const checkpointActions = checkpointId && allDone ? (
    <div className="flex flex-wrap items-center gap-2">
      <Badge
        variant={isSavedCheckpoint ? 'default' : 'outline'}
        className="h-6 px-2 text-xs"
      >
        {isSavedCheckpoint ? 'Saved version' : 'Checkpoint'}
      </Badge>
      {onRestore && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onRestore(checkpointId)}
          className="h-6 px-2 text-xs"
          title="Restore to this checkpoint"
        >
          <RotateCcw className="h-3 w-3 mr-1" />
          Restore
        </Button>
      )}
    </div>
  ) : null;

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2 flex-1">
          <button
            onClick={onToggleExpand}
            className="mt-0.5 hover:bg-muted rounded p-0.5"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
          
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{title}</span>
              {inProgress && (
                <span className="text-xs text-blue-500 animate-pulse">
                  In Progress...
                </span>
              )}
              {allDone && (
                <span className={cn(
                  "text-xs",
                  failedCount === 0 ? "text-green-500" : "text-orange-500"
                )}>
                  {failedCount === 0 ? '✓ Complete' : `⚠ ${completedCount}/${steps.length} succeeded`}
                </span>
              )}
            </div>
            
            {/* Summary when collapsed */}
            {!expanded && steps.length > 0 && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Check className="h-3 w-3 text-green-500" />
                  {completedCount}
                </span>
                {failedCount > 0 && (
                  <span className="flex items-center gap-1">
                    <X className="h-3 w-3 text-red-500" />
                    {failedCount}
                  </span>
                )}
                <span>{steps.length} total</span>
              </div>
            )}
          </div>
        </div>

        
      </div>

      {/* Step List */}
      {expanded && steps.length > 0 && (
        <div className="ml-6 space-y-1 text-sm">
          {steps.map((step) => (
            <div
              key={step.id}
              className={cn(
                "flex items-start gap-2 py-1",
                statusColors[step.status]
              )}
            >
              <span className="mt-0.5">{statusIcons[step.status]}</span>
              <div className="flex-1 space-y-0.5">
                <div>{step.description}</div>
                {step.error && (
                  <div className="text-xs text-red-400 ml-6">
                    Error: {step.error}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {checkpointActions && (
        <div className="ml-6">
          {checkpointActions}
        </div>
      )}
    </div>
  );
}

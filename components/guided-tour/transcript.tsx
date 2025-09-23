'use client';

import React from 'react';
import { GuidedTourTranscriptEvent } from './types';
import { cn } from '@/lib/utils';

interface GuidedTourTranscriptProps {
  events: GuidedTourTranscriptEvent[];
}

export function GuidedTourTranscript({ events }: GuidedTourTranscriptProps) {
  if (!events.length) {
    return (
      <div className="rounded-lg border bg-muted/40 p-4 text-xs text-muted-foreground">
        Steps will appear here while the agent works.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-background/90 p-3 max-h-64 overflow-y-auto space-y-3 text-xs">
      {events.map((event) => {
        if (event.role === 'tool') {
          return (
            <div key={event.id} className="space-y-2 rounded-md border border-border/60 bg-muted/30 p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Tool: {event.name}</div>
              <div className="rounded bg-background/80 p-2 font-mono text-[11px] text-foreground">
                {event.command}
              </div>
              <pre className="whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px] text-muted-foreground">
                {event.output}
              </pre>
            </div>
          );
        }

        if (event.role === 'clear') {
          return (
            <div key={event.id} className="rounded-md border border-border/60 bg-muted/30 p-3 text-center text-muted-foreground">
              Conversation cleared
            </div>
          );
        }

        const roleLabel = event.role === 'user' ? 'User' : event.role === 'assistant' ? 'Assistant' : 'System';
        const tone = event.tone ?? 'info';
        return (
          <div
            key={event.id}
            className={cn(
              'rounded-md border p-3 space-y-2',
              tone === 'plan' && 'border-blue-400/40 bg-blue-500/10 text-blue-200',
              tone === 'success' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
              tone === 'info' && 'border-border/60 bg-muted/30 text-foreground'
            )}
          >
            <div className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">
              {roleLabel}
            </div>
            <pre className="whitespace-pre-wrap font-medium text-[12px] leading-relaxed">
              {event.content}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useGuidedTour } from './context';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface GuidedTourOverlayProps {
  location: 'global' | 'project-manager' | 'workspace' | 'settings';
}

interface HighlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function GuidedTourOverlay({ location }: GuidedTourOverlayProps) {
  const { state, next, previous, skip } = useGuidedTour();
  const { status, currentStep, stepKey, isBusy } = state;
  const [rect, setRect] = useState<HighlightRect | null>(null);

  useEffect(() => {
    if (status !== 'running') return;
    if (!currentStep) return;
    if (currentStep.location !== location) return;
    if (!currentStep.target) {
      setRect(null);
      return;
    }

    let cancelled = false;
    const selector = currentStep.target;

    const updateRect = () => {
      if (cancelled) return;
      // Find all matching elements
      const elements = document.querySelectorAll(selector);
      let visibleEl: HTMLElement | null = null;
      
      // Find the first visible element
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i] as HTMLElement;
        // Check if element is visible (has dimensions)
        if (el.offsetWidth > 0 && el.offsetHeight > 0) {
          visibleEl = el;
          break;
        }
      }
      
      if (visibleEl) {
        const bounds = visibleEl.getBoundingClientRect();
        setRect({
          top: bounds.top,
          left: bounds.left,
          width: bounds.width,
          height: bounds.height,
        });
        return true;
      }
      setRect(null);
      return false;
    };

    updateRect();
    const interval = window.setInterval(() => {
      if (updateRect()) {
        window.clearInterval(interval);
      }
    }, 250);
    window.addEventListener('resize', updateRect);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('resize', updateRect);
    };
  }, [status, currentStep, location, stepKey]);

  const disableNext = useMemo(() => {
    if (!currentStep) return false;
    if (!isBusy) return false;
    return currentStep.id === 'workspace-edit' || currentStep.id === 'workspace-focus' || currentStep.id === 'workspace-checkpoint';
  }, [currentStep, isBusy]);

  if (status !== 'running' || !currentStep || currentStep.location !== location) {
    return null;
  }

  const primaryLabel = currentStep.primaryLabel ?? 'Next';
  const secondaryLabel = currentStep.secondaryLabel ?? 'Skip';
  return (
    <div className="fixed inset-0 z-[2000] pointer-events-auto">
      <div className="absolute inset-0 bg-background/30" />
      {rect && (
        <div
          className="pointer-events-none fixed rounded-xl border-2 border-primary ring-4 ring-primary/30 transition-all"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
        />
      )}

      <div className="absolute bottom-10 left-1/2 flex w-full max-w-xl -translate-x-1/2 flex-col gap-4 px-4">
        <div className="pointer-events-auto rounded-2xl border bg-background/95 p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">{currentStep.title}</h3>
              <div className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {currentStep.body}
              </div>
            </div>
            {isBusy && (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            )}
          </div>

          <div className="mt-6 flex items-center justify-between">
            {currentStep.showBack ? (
              <Button variant="ghost" onClick={previous} disabled={isBusy}>
                Back
              </Button>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={skip}>
                {secondaryLabel}
              </Button>
              <Button onClick={next} disabled={disableNext}>
                {primaryLabel}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

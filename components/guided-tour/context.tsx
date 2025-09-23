'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { configManager } from '@/lib/config/storage';
import { GUIDED_TOUR_STEPS } from './steps';
import {
  GuidedTourEventHandler,
  GuidedTourStepContent,
  GuidedTourTranscriptEvent,
} from './types';
import { Project } from '@/lib/vfs/types';
import { runGuidedDemoEdit, runGuidedFocusDemo } from './demo-runner';
import { checkpointManager } from '@/lib/vfs/checkpoint';
import { saveManager } from '@/lib/vfs/save-manager';

interface TourWorkspaceData {
  projectId: string | null;
  preCheckpointId: string | null;
  postCheckpointId: string | null;
  originalCss: string | null;
  updatedCss: string | null;
}

interface GuidedTourState {
  status: 'idle' | 'running' | 'completed';
  stepIndex: number;
  stepKey: number;
  currentStep?: GuidedTourStepContent;
  transcript: GuidedTourTranscriptEvent[];
  isBusy: boolean;
  projectList: Project[];
}

interface GuidedTourContextValue {
  state: GuidedTourState;
  start: () => void;
  skip: () => void;
  next: () => void;
  previous: () => void;
  setProjectList: (projects: Project[]) => void;
  setActiveProjectId: (projectId: string | null) => void;
  setTranscript: React.Dispatch<React.SetStateAction<GuidedTourTranscriptEvent[]>>;
  setWorkspaceHandler: (handler: GuidedTourEventHandler | null) => void;
}

const GuidedTourContext = createContext<GuidedTourContextValue | null>(null);

function getStepByIndex(index: number): GuidedTourStepContent | undefined {
  if (index < 0 || index >= GUIDED_TOUR_STEPS.length) {
    return undefined;
  }
  return GUIDED_TOUR_STEPS[index];
}

export function GuidedTourProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<'idle' | 'running' | 'completed'>('idle');
  const [stepIndex, setStepIndex] = useState(0);
  const [stepKey, setStepKey] = useState(0);
  const [transcript, setTranscript] = useState<GuidedTourTranscriptEvent[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [workspaceData, setWorkspaceData] = useState<TourWorkspaceData>({
    projectId: null,
    preCheckpointId: null,
    postCheckpointId: null,
    originalCss: null,
    updatedCss: null,
  });
  const workspaceDataRef = useRef(workspaceData);

  const workspaceEditRunKey = useRef<number | null>(null);
  const focusDemoRunKey = useRef<number | null>(null);
  const checkpointRunKey = useRef<number | null>(null);
  const clearConversationRunKey = useRef<number | null>(null);
  const demoAbortController = useRef<AbortController | null>(null);
  const workspaceHandlerRef = useRef<GuidedTourEventHandler | null>(null);

  const currentStep = useMemo(() => getStepByIndex(stepIndex), [stepIndex]);

  const resetWorkspaceData = useCallback(() => {
    setWorkspaceData({
      projectId: null,
      preCheckpointId: null,
      postCheckpointId: null,
      originalCss: null,
      updatedCss: null,
    });
    workspaceEditRunKey.current = null;
    focusDemoRunKey.current = null;
    checkpointRunKey.current = null;
    clearConversationRunKey.current = null;
  }, []);

  const start = useCallback(() => {
    if (status === 'running') return;
    setStatus('running');
    setStepIndex(0);
    setStepKey((key) => key + 1);
    setTranscript([]);
    resetWorkspaceData();
  }, [resetWorkspaceData, status]);

  const setWorkspaceHandler = useCallback((handler: GuidedTourEventHandler | null) => {
    workspaceHandlerRef.current = handler;
  }, []);

  // Automatic tour start is now handled by the project manager
  // to ensure a demo project is created first if needed

  useEffect(() => {
    workspaceDataRef.current = workspaceData;
  }, [workspaceData]);

  const completeTour = useCallback((mode: 'finish' | 'skip' = 'finish') => {
    const currentData = workspaceDataRef.current;
    if (currentData.projectId && currentData.preCheckpointId && currentData.postCheckpointId) {
      saveManager
        .runWithSuppressedDirty(currentData.projectId, async () => {
          await checkpointManager.restoreCheckpoint(currentData.preCheckpointId!);
        })
        .then(() => {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('filesChanged'));
          }
        })
        .catch((error) => {
          console.error('[GuidedTour] Failed to restore baseline during cleanup', error);
        });
    }
    resetWorkspaceData();
    setTranscript([]);
    setStepIndex(0);
    setStepKey((key) => key + 1);
    setStatus(mode === 'finish' ? 'completed' : 'idle');
    configManager.setHasSeenTour(true);
    demoAbortController.current?.abort();
    workspaceHandlerRef.current = null;
  }, [resetWorkspaceData]);

  const skip = useCallback(() => {
    completeTour('skip');
  }, [completeTour]);

  const next = useCallback(() => {
    setStepIndex((index) => {
      const nextIndex = index + 1;
      if (nextIndex >= GUIDED_TOUR_STEPS.length) {
        completeTour();
        return index;
      }
      setStepKey((key) => key + 1);
      return nextIndex;
    });
  }, [completeTour]);

  const previous = useCallback(() => {
    setStepIndex((index) => {
      const prevIndex = Math.max(0, index - 1);
      if (prevIndex !== index) {
        setStepKey((key) => key + 1);
      }
      return prevIndex;
    });
  }, []);

  // Teardown controller on unmount or when tour stops
  useEffect(() => {
    if (status !== 'running') {
      demoAbortController.current?.abort();
      demoAbortController.current = null;
    }
  }, [status]);

  // Run scripted workspace edit when reaching that step
  useEffect(() => {
    if (status !== 'running') return;
    const step = currentStep;
    if (!step) return;

    if (step.id === 'workspace-edit') {
      if (!activeProjectId) {
        return;
      }
      if (workspaceEditRunKey.current === stepKey) {
        return;
      }
      workspaceEditRunKey.current = stepKey;
      setIsBusy(true);
      setTranscript([]);

      const controller = new AbortController();
      demoAbortController.current?.abort();
      demoAbortController.current = controller;

      runGuidedDemoEdit({
        projectId: activeProjectId,
        emit: (event) => {
          setTranscript((prev) => [...prev, event]);
        },
        onWorkspaceEvent: (event) => workspaceHandlerRef.current?.(event),
        signal: controller.signal,
      })
        .then((data) => {
          setWorkspaceData((prev) => ({
            ...prev,
            projectId: activeProjectId,
            preCheckpointId: data.preChangeCheckpointId,
            postCheckpointId: data.postChangeCheckpointId,
            originalCss: data.originalCss,
            updatedCss: data.updatedCss,
          }));
        })
        .catch((error) => {
          if (error?.message !== 'aborted') {
            console.error('[GuidedTour] Demo run failed', error);
          }
        })
        .finally(() => {
          if (demoAbortController.current === controller) {
            demoAbortController.current = null;
          }
          setIsBusy(false);
        });
      return () => {
        controller.abort();
      };
    }

    if (step.id === 'workspace-focus') {
      if (focusDemoRunKey.current === stepKey) {
        return;
      }
      focusDemoRunKey.current = stepKey;
      setIsBusy(true);
      
      const controller = new AbortController();
      demoAbortController.current?.abort();
      demoAbortController.current = controller;
      
      runGuidedFocusDemo({
        signal: controller.signal,
      })
        .catch((error) => {
          if (error?.message !== 'aborted') {
            console.error('[GuidedTour] Focus demo failed', error);
          }
        })
        .finally(() => {
          if (demoAbortController.current === controller) {
            demoAbortController.current = null;
          }
          setIsBusy(false);
        });
      
      return () => {
        controller.abort();
      };
    }

    if (step.id === 'workspace-checkpoint') {
      if (!workspaceData.projectId || !workspaceData.preCheckpointId) {
        return;
      }
      if (checkpointRunKey.current === stepKey) {
        return;
      }
      checkpointRunKey.current = stepKey;
      setIsBusy(true);
      (async () => {
        try {
          await saveManager.runWithSuppressedDirty(workspaceData.projectId!, async () => {
            await checkpointManager.restoreCheckpoint(workspaceData.preCheckpointId!);
          });
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('filesChanged'));
          }
          setWorkspaceData((prev) => ({
            ...prev,
            postCheckpointId: null,
          }));
          const message = {
            id: `restore-${Date.now()}`,
            role: 'assistant' as const,
            tone: 'info' as const,
            content: 'Restored the checkpoint from before the color change so you can compare both versions.',
          };
          setTranscript((prev) => [...prev, message]);
          workspaceHandlerRef.current?.(message);
        } catch (error) {
          console.error('[GuidedTour] Failed to restore checkpoint', error);
        } finally {
          setIsBusy(false);
        }
      })();
    }

    if (step.id === 'clear-conversation') {
      if (clearConversationRunKey.current === stepKey) {
        return;
      }
      clearConversationRunKey.current = stepKey;
      
      // Send clear event to workspace to clear its messages
      const clearEvent = {
        id: `clear-conversation-${Date.now()}`,
        role: 'clear' as const,
        action: 'conversation' as const,
      };
      workspaceHandlerRef.current?.(clearEvent);
      
      // Clear the tour transcript as well
      setTranscript([]);
      
      // Add a brief message to show the clearing happened
      const message = {
        id: `clear-message-${Date.now()}`,
        role: 'assistant' as const,
        tone: 'info' as const,
        content: 'Conversation cleared. The agent now has a fresh start without the previous task history.',
      };
      
      setTimeout(() => {
        setTranscript([message]);
        workspaceHandlerRef.current?.(message);
        // Clear it again after showing the message briefly
        setTimeout(() => {
          setTranscript([]);
        }, 2000);
      }, 100);
    }
  }, [status, currentStep, stepKey, activeProjectId, workspaceData]);

  // Reset helpers when step changes away
  useEffect(() => {
    if (currentStep?.id !== 'workspace-edit') {
      demoAbortController.current?.abort();
      demoAbortController.current = null;
    }
  }, [currentStep]);

  const value = useMemo<GuidedTourContextValue>(
    () => ({
      state: {
        status,
        stepIndex,
        stepKey,
        currentStep,
        transcript,
        isBusy,
        projectList,
      },
      start,
      skip,
      next,
      previous,
      setProjectList: (projects: Project[]) => {
        setProjectList(projects);
      },
      setActiveProjectId,
      setTranscript,
      setWorkspaceHandler,
    }),
    [status, stepIndex, stepKey, currentStep, transcript, isBusy, projectList, start, skip, next, previous, setWorkspaceHandler]
  );

  return (
    <GuidedTourContext.Provider value={value}>
      {children}
    </GuidedTourContext.Provider>
  );
}

export function useGuidedTour(): GuidedTourContextValue {
  const ctx = useContext(GuidedTourContext);
  if (!ctx) {
    throw new Error('useGuidedTour must be used within a GuidedTourProvider');
  }
  return ctx;
}

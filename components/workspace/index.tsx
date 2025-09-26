'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Project, VirtualFile } from '@/lib/vfs/types';
import { vfs } from '@/lib/vfs';
import { logger } from '@/lib/utils';
import { FileExplorer } from '@/components/file-explorer';
import { MultiTabEditor, openFileInEditor } from '@/components/editor/multi-tab-editor';
import { MultipagePreview } from '@/components/preview/multipage-preview';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Send, Loader2, RotateCcw, MessageSquare, FolderTree, Code2, Eye, ChevronDown, ChevronUp, Settings, Trash2, Save, Info, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { AppHeader, HeaderAction } from '@/components/ui/app-header';
import { Orchestrator } from '@/lib/llm/orchestrator';
import { configManager } from '@/lib/config/storage';
import { useCostSettings } from '@/lib/hooks/use-cost-settings';
import { getProvider } from '@/lib/llm/providers/registry';
import { toast } from 'sonner';
import { conversationState } from '@/lib/llm/conversation-state';
import { ConversationConverter } from '@/lib/llm/conversation-converter-simple';
import { buildShellSystemPrompt } from '@/lib/llm/system-prompt';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import { checkpointManager } from '@/lib/vfs/checkpoint';
import { saveManager } from '@/lib/vfs/save-manager';
import { TaskProgressDisplay, TaskStep } from '@/components/task-progress';
import { AssistantMessage } from '@/components/assistant-message';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ModelSettingsPanel } from '@/components/settings/model-settings';
import { SettingsPanel } from '@/components/settings';
import { GuidedTourOverlay } from '@/components/guided-tour/overlay';
import { useGuidedTour } from '@/components/guided-tour/context';
import { GuidedTourTranscriptEvent } from '@/components/guided-tour/types';
import { FocusContextPayload } from '@/lib/preview/types';

interface ToolMessageItem {
  id: string;
  type: 'message' | 'tool' | 'divider';
  content?: string;
  name?: string;
  parameters?: any;
  result?: any;
  status?: 'pending' | 'executing' | 'completed' | 'failed';
  title?: string;
  subtitle?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  checkpointId?: string;
  isTask?: boolean;
  taskSteps?: TaskStep[];
  taskTitle?: string;
  toolCalls?: Array<{
    name: string;
    parameters?: any;
    result?: any;
    status?: 'pending' | 'executing' | 'completed' | 'failed';
  }>;
  toolMessages?: ToolMessageItem[];
  cost?: number;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    provider?: string;
    model?: string;
  };
}

interface WorkspaceProps {
  project: Project;
  onBack: () => void;
}

type FocusTarget = FocusContextPayload & { timestamp: number };

export function Workspace({ project, onBack }: WorkspaceProps) {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [currentOrchestrator, setCurrentOrchestrator] = useState<Orchestrator | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeMobilePanel, setActiveMobilePanel] = useState<'assistant' | 'files' | 'editor' | 'preview'>('preview');
  const [isDirty, setIsDirty] = useState(false);
  const [saveInProgress, setSaveInProgress] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(project.lastSavedAt ?? null);
  const [focusContext, setFocusContext] = useState<FocusTarget | null>(null);
  const lastFocusSignatureRef = useRef<{ signature: string; timestamp: number } | null>(null);
  const currentAssistantIdx = useRef<number | null>(null);
  const idCounterRef = useRef(0);
  const makeId = useCallback((): string => {
    try {
      const anyCrypto = (globalThis as any)?.crypto;
      if (anyCrypto && typeof anyCrypto.randomUUID === 'function') {
        return anyCrypto.randomUUID();
      }
    } catch {}
    const id = `${Date.now()}_${idCounterRef.current}`;
    idCounterRef.current += 1;
    return id;
  }, []);
  const ensureStreamingAssistant = useCallback((arr: Message[]): { arr: Message[]; idx: number } => {
    // Check if current index is valid for this array
    if (currentAssistantIdx.current != null && 
        currentAssistantIdx.current >= 0 && 
        currentAssistantIdx.current < arr.length && 
        arr[currentAssistantIdx.current] && 
        arr[currentAssistantIdx.current].role === 'assistant' &&
        !arr[currentAssistantIdx.current].checkpointId) {
      // Valid streaming assistant exists
      return { arr, idx: currentAssistantIdx.current };
    }
    
    // Need to create or find a streaming assistant
    const last = arr[arr.length - 1];
    const needsNewAssistant = !last ||
      last.role !== 'assistant' ||
      Boolean(last.checkpointId) ||
      Boolean((last as any).isTask);

    if (needsNewAssistant) {
      const msg: Message = { id: makeId(), role: 'assistant', content: '', toolMessages: [] } as any;
      const next = [...arr, msg];
      currentAssistantIdx.current = next.length - 1;
      return { arr: next, idx: currentAssistantIdx.current };
    } else {
      // Reuse the last assistant message
      currentAssistantIdx.current = arr.length - 1;
      return { arr, idx: currentAssistantIdx.current };
    }
  }, [makeId]);
  const [initialCheckpointId, setInitialCheckpointId] = useState<string | null>(null);
  const [expandedTasks, setExpandedTasks] = useState<Set<number>>(new Set());
  const [currentModel, setCurrentModel] = useState(configManager.getDefaultModel());
  const [showDesktopSettings, setShowDesktopSettings] = useState(false);
  const [showMobileSettings, setShowMobileSettings] = useState(false);
  const [projectCost, setProjectCost] = useState(0);
  const { state: tourState, start: startTour, setWorkspaceHandler } = useGuidedTour();
  const tourStep = tourState.currentStep?.id;
  const tourRunning = tourState.status === 'running';
  const isTourLockingInput = tourRunning && tourStep !== 'wrap-up';
  
  // Get cost settings for conditional display  
  const { shouldShowCosts } = useCostSettings();
  
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isAutoScrollEnabled = useRef(true);
  const isUserScrolling = useRef(false);
  
  const [showAssistant, setShowAssistant] = useState(true);
  const [showFiles, setShowFiles] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  
  const getDefaultSizes = () => {
    const visiblePanels = [showAssistant, showFiles, showEditor, showPreview].filter(Boolean).length;
    
    if (visiblePanels === 4) {
      return { assistant: 25, files: 15, editor: 35, preview: 25 };
    } else if (visiblePanels === 3) {
      if (!showAssistant) return { assistant: 0, files: 20, editor: 40, preview: 40 };
      if (!showFiles) return { assistant: 30, files: 0, editor: 40, preview: 30 };
      if (!showEditor) return { assistant: 33, files: 20, editor: 0, preview: 47 };
      if (!showPreview) return { assistant: 30, files: 20, editor: 50, preview: 0 };
    } else if (visiblePanels === 2) {
      return { assistant: 50, files: 50, editor: 50, preview: 50 };
    }
    return { assistant: 100, files: 100, editor: 100, preview: 100 };
  };
  
  const defaultSizes = getDefaultSizes();

  const getModelDisplayName = (modelId: string) => {
    if (!modelId) return 'Select Model';
    const parts = modelId.split('/');
    const modelName = parts[parts.length - 1];
    return modelName
      .split('-')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  };

  const truncateHtmlSnippet = useCallback((html: string, maxLength: number = 1200) => {
    if (!html) {
      return '';
    }
    if (html.length <= maxLength) {
      return html;
    }
    const headLength = Math.max(0, Math.floor(maxLength * 0.6));
    const tailLength = Math.max(0, Math.floor(maxLength * 0.3));
    const head = html.slice(0, headLength);
    const tail = tailLength > 0 ? html.slice(-tailLength) : '';
    return `${head}\n  (...truncated...)\n${tail}`;
  }, []);

  const describeFocusTarget = useCallback((target: FocusTarget) => {
    const attributeEntries = Object.entries(target.attributes || {}).slice(0, 6);
    if (attributeEntries.length === 0) {
      return `<${target.tagName}>`;
    }
    const summary = attributeEntries
      .map(([key, value]) => {
        const trimmed = value.length > 40 ? `${value.slice(0, 37)}…` : value;
        return `${key}="${trimmed}"`;
      })
      .join(' ');
    return `<${target.tagName} ${summary}>`;
  }, []);

  const formatFocusContextBlock = useCallback((target: FocusTarget) => {
    const descriptor = describeFocusTarget(target);
    const snippet = truncateHtmlSnippet(target.outerHTML, 1200);
    const domPath = target.domPath || '(unknown path)';
    return [
      'Focus context:',
      `- Target: ${descriptor}`,
      `- DOM path: ${domPath}`,
      '- HTML snippet:',
      '```html',
      snippet,
      '```'
    ].join('\n');
  }, [describeFocusTarget, truncateHtmlSnippet]);

  const handleFocusSelection = useCallback((selection: FocusContextPayload | null) => {
    if (!selection) {
      setFocusContext(null);
      lastFocusSignatureRef.current = null;
      return;
    }
    const signature = `${selection.domPath || ''}::${selection.tagName || ''}::${selection.outerHTML ? selection.outerHTML.length : 0}`;
    const now = Date.now();
    if (lastFocusSignatureRef.current && lastFocusSignatureRef.current.signature === signature && (now - lastFocusSignatureRef.current.timestamp) < 400) {
      return;
    }
    const nextTarget: FocusTarget = {
      ...selection,
      timestamp: now
    };
    setFocusContext(nextTarget);
    toast.info('Focus context set', {
      description: describeFocusTarget(nextTarget)
    });
    lastFocusSignatureRef.current = { signature, timestamp: now };
  }, [describeFocusTarget]);

  const focusDescriptor = focusContext ? describeFocusTarget(focusContext) : '';
  const focusPreviewSnippet = focusContext ? truncateHtmlSnippet(focusContext.outerHTML, 240) : '';

  const trimmedSnippet = focusPreviewSnippet?.trim() ?? '';

  const focusContextHint = focusContext ? (
    <div
      id="focus-context-hint"
      className="rounded-md border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-xs text-muted-foreground shadow-sm"
    >
        <div className="flex flex-wrap items-center justify-between gap-2 text-foreground">
          <div className="flex items-center gap-2">
            <span className="font-medium text-xs uppercase tracking-wide text-primary">context</span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">included in next message</span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={() => setFocusContext(null)}
            title="Clear focus context"
          >
            Clear
          </Button>
        </div>
        <div className="mt-2 space-y-2">
        {focusContext.domPath && (
          <div className="text-[11px] font-mono text-muted-foreground/80 break-all leading-snug">
            {focusContext.domPath}
          </div>
        )}
        {trimmedSnippet && (
          <pre className="max-h-24 overflow-auto rounded border border-border/50 bg-background/90 px-2 py-1 text-[11px] text-foreground leading-relaxed">
            <code>{trimmedSnippet}</code>
          </pre>
        )}
      </div>
    </div>
  ) : null;

  useEffect(() => {
    setIsDirty(saveManager.isDirty(project.id));
    const unsubscribe = saveManager.subscribe(({ projectId, dirty }) => {
      if (projectId === project.id) {
        setIsDirty(dirty);
      }
    });
    return () => unsubscribe();
  }, [project.id]);

  useEffect(() => {
    let isMounted = true;

    const initializeWorkspace = async () => {
      try {
        await saveManager.syncProjectSaveState(project.id);
        let savedCheckpointId = saveManager.getSavedCheckpointId(project.id);

        if (savedCheckpointId) {
          const restored = await saveManager.restoreLastSaved(project.id);
          if (!restored) {
            logger.warn('[Workspace] Saved checkpoint missing or failed to restore, creating new baseline');
            const checkpoint = await saveManager.save(project.id, 'Initial manual save');
            savedCheckpointId = checkpoint.id;
          }
        } else {
          const checkpoint = await saveManager.save(project.id, 'Initial manual save');
          savedCheckpointId = checkpoint.id;
        }

        if (!isMounted) return;

        if (savedCheckpointId) {
          setInitialCheckpointId(savedCheckpointId);
        }

        const latestProject = await vfs.getProject(project.id);
        if (!isMounted) return;
        setLastSavedAt(latestProject.lastSavedAt ?? null);
        setIsDirty(saveManager.isDirty(project.id));

        logger.debug(`[Workspace] Initializing workspace for project: ${project.id}`);
        const existingConversation = await conversationState.getConversation(project.id);
        if (!isMounted) return;
        logger.debug(`[Workspace] Loaded conversation state:`, {
          messageCount: existingConversation.messages.length,
          lastUpdated: existingConversation.lastUpdated,
          version: existingConversation.version
        });

        if (existingConversation.messages.length > 0) {
          logger.debug(`[Workspace] Converting ${existingConversation.messages.length} orchestrator messages to UI format`);

          const nonSystemMessages = existingConversation.messages.filter(m => m.role !== 'system');
          if (nonSystemMessages.length === 0) {
            logger.warn(`[Workspace] Conversation contains only system messages - clearing`);
            await conversationState.clearConversation(project.id);
            if (!isMounted) return;
            logger.debug(`[Workspace] No existing conversation found - starting fresh`);
            return;
          }

          const uiMessages = ConversationConverter.convertToUIMessages(existingConversation.messages);
          const filteredMessages = uiMessages.filter(m => m.id && m.role) as Message[];

          logger.debug(`[Workspace] Conversion result:`, {
            originalCount: existingConversation.messages.length,
            convertedCount: uiMessages.length,
            filteredCount: filteredMessages.length,
            messageTypes: existingConversation.messages.map(m => m.role),
            convertedTypes: uiMessages.map(m => m.role)
          });

          if (!isMounted) return;
          setMessages(filteredMessages);

          await conversationState.recordConversationBreak(project.id, {
            type: 'page_refresh',
            timestamp: new Date().toISOString(),
            description: 'Page refreshed, conversation restored'
          });

          await conversationState.addBreakContextMessage(project.id, {
            type: 'page_refresh',
            timestamp: new Date().toISOString(),
            description: 'Page refreshed, conversation restored'
          });

          logger.debug(`[Workspace] Restored conversation with ${filteredMessages.length} UI messages displayed`);
        } else {
          logger.debug(`[Workspace] No existing conversation found - starting fresh`);
        }
      } catch (error) {
        if (!isMounted) return;
        logger.error('Failed to initialize workspace:', error);
      }
    };

    initializeWorkspace();

    const updateProjectCost = async () => {
      try {
        const currentProject = await vfs.getProject(project.id);
        if (!isMounted) return;
        if (currentProject?.costTracking?.totalCost) {
          setProjectCost(currentProject.costTracking.totalCost);
        } else {
          setProjectCost(0);
        }
      } catch (error) {
        if (!isMounted) return;
        setProjectCost(0);
      }
    };

    updateProjectCost();
    const interval = setInterval(updateProjectCost, 2000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [project.id]);

  useEffect(() => {
    if (!tourRunning) {
      setShowDesktopSettings(false);
      setShowMobileSettings(false);
      return;
    }

    if (tourStep === 'provider-settings') {
      setShowDesktopSettings(true);
      setShowMobileSettings(true);
    } else {
      setShowDesktopSettings(false);
      setShowMobileSettings(false);
    }
  }, [tourRunning, tourStep]);

  useEffect(() => {
    if (!tourRunning) {
      setWorkspaceHandler(null);
      setGenerating(false);
      return;
    }

    setGenerating(tourStep === 'workspace-edit');

    const handler = (event: GuidedTourTranscriptEvent) => {
      if (event.role === 'user') {
        setMessages(prev => [...prev, { id: makeId(), role: 'user', content: event.content }]);
        return;
      }

      if (event.role === 'assistant') {
        setMessages(prev => {
          const { arr, idx } = ensureStreamingAssistant([...prev]);
          const base = arr[idx];
          const nextContent = base.content ? `${base.content}\n\n${event.content}` : event.content;
          arr[idx] = {
            ...base,
            content: nextContent,
            toolMessages: base.toolMessages ?? [],
            checkpointId: event.checkpointId ?? base.checkpointId,
          };
          return arr;
        });
        if (event.tone === 'success') {
          setGenerating(false);
        }
        return;
      }

      if (event.role === 'tool') {
        setMessages(prev => {
          const { arr, idx } = ensureStreamingAssistant([...prev]);
          const base = arr[idx];
          const toolMessages = [...(base.toolMessages ?? [])];
          
          // Parse the command to match the expected format
          let toolName = event.name;
          let parameters: any = {};
          
          if (event.name === 'shell' && event.command) {
            // Extract the actual command name from the command string
            const parts = event.command.trim().split(/\s+/);
            if (parts.length > 0) {
              // Create the cmd array format expected by assistant-message
              parameters = { cmd: parts };
            } else {
              parameters = { command: event.command };
            }
          } else if (event.name === 'json_patch') {
            // Use json_patch as the tool name
            toolName = 'json_patch';
            parameters = { command: event.command };
          } else {
            parameters = { command: event.command };
          }
          
          toolMessages.push({
            id: makeId(),
            type: 'tool',
            name: toolName,
            parameters,
            result: event.output,
            status: 'completed',
          } as ToolMessageItem);
          arr[idx] = { ...base, toolMessages };
          return arr;
        });
        return;
      }

      if (event.role === 'clear' && event.action === 'conversation') {
        currentAssistantIdx.current = null;
        setMessages([]);
        return;
      }
    };

    setWorkspaceHandler(handler);

    return () => {
      setWorkspaceHandler(null);
    };
  }, [tourRunning, tourStep, setWorkspaceHandler, ensureStreamingAssistant, makeId]);

  useEffect(() => {
    if (isAutoScrollEnabled.current && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Improve autoscroll reliability with a sentinel observer
  useEffect(() => {
    const root = messagesContainerRef.current;
    const target = messagesEndRef.current;
    if (!root || !target) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        const atBottom = entry.isIntersecting || entry.intersectionRatio > 0.5;
        isAutoScrollEnabled.current = atBottom;
        if (atBottom) isUserScrolling.current = false;
      },
      { root, threshold: [0, 0.5, 1] }
    );
    obs.observe(target);
    return () => {
      obs.disconnect();
    };
  }, []);

  const handleScroll = useCallback(() => {
    if (!messagesContainerRef.current) return;
    
    const container = messagesContainerRef.current;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    
    if (distanceFromBottom < 100) {
      isAutoScrollEnabled.current = true;
      isUserScrolling.current = false;
    } else {
      if (!generating) {
        isAutoScrollEnabled.current = false;
        isUserScrolling.current = true;
      }
    }
  }, [generating]);

  const handleFileSelect = useCallback((file: VirtualFile) => {
    // Check if we're on mobile (matches Tailwind's md breakpoint)
    const isMobile = window.innerWidth < 768;
    
    if (isMobile) {
      // On mobile, switch to editor panel and open file
      setActiveMobilePanel('editor');
      setTimeout(() => {
        openFileInEditor(file);
      }, 0);
    } else {
      // Desktop behavior remains the same
      if (!showEditor) {
        setShowEditor(true);
        setTimeout(() => {
          openFileInEditor(file);
        }, 0);
      } else {
        openFileInEditor(file);
      }
    }
  }, [showEditor]);

  const handleFilesChange = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
    window.dispatchEvent(new CustomEvent('filesChanged'));
  }, []);

  const handleSave = useCallback(async () => {
    if (saveInProgress) {
      return;
    }

    setSaveInProgress(true);
    try {
      const checkpoint = await saveManager.save(project.id);
      const latestProject = await vfs.getProject(project.id);
      setLastSavedAt(latestProject.lastSavedAt ?? new Date(checkpoint.timestamp));
      setInitialCheckpointId(checkpoint.id);
      const timestamp = new Date().toISOString();
      const breakInfo = {
        type: 'manual_save' as const,
        timestamp,
        checkpointId: checkpoint.id,
        description: 'Manual save'
      };
      await conversationState.recordConversationBreak(project.id, breakInfo);
      await conversationState.addBreakContextMessage(project.id, breakInfo);
      toast.success('Project saved');
    } catch (error) {
      logger.error('Failed to save project', error);
      toast.error('Failed to save project');
    } finally {
      setSaveInProgress(false);
    }
  }, [project.id, saveInProgress]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform?.toLowerCase().includes('mac');
      const modifierPressed = isMac ? event.metaKey : event.ctrlKey;
      if (!modifierPressed) return;

      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  
  const handleRestoreCheckpoint = useCallback(async (checkpointId: string, description?: string) => {
    try {
      // First check if checkpoint exists
      const exists = await checkpointManager.checkpointExists(checkpointId);
      if (!exists) {
        toast.error('Checkpoint no longer exists - it may have been cleaned up');
        logger.warn(`[Workspace] Checkpoint ${checkpointId} no longer exists`);
        return;
      }
      
      const success = await saveManager.runWithSuppressedDirty(project.id, () =>
        checkpointManager.restoreCheckpoint(checkpointId)
      );
      if (success) {
        toast.success(`Restored to: ${description || 'checkpoint'}`);
        handleFilesChange();
        
        // Record the checkpoint restoration
        await conversationState.recordConversationBreak(project.id, {
          type: 'checkpoint_restore',
          timestamp: new Date().toISOString(),
          checkpointId,
          description: description || 'checkpoint'
        });
        
        // Add context message for the LLM about the restoration
        await conversationState.addBreakContextMessage(project.id, {
          type: 'checkpoint_restore',
          timestamp: new Date().toISOString(),
          checkpointId,
          description: description || 'checkpoint'
        });

        const savedId = saveManager.getSavedCheckpointId(project.id);
        if (savedId && savedId === checkpointId) {
          saveManager.markClean(project.id);
          const latestProject = await vfs.getProject(project.id);
          setLastSavedAt(latestProject.lastSavedAt ?? null);
        } else {
          saveManager.markDirty(project.id);
        }

        // Add UI message for user feedback
        setMessages(prev => [...prev, {
          id: makeId(),
          role: 'assistant',
          content: `Restored to checkpoint: ${description || 'previous state'}`,
          checkpointId
        }]);
        
        // Persist the updated conversation
        const orchestratorMessages = ConversationConverter.convertToOrchestratorMessages(messages);
        await conversationState.updateConversation(project.id, orchestratorMessages);
      } else {
        toast.error('Failed to restore checkpoint');
      }
    } catch (error) {
      logger.error('Error restoring checkpoint:', error);
      toast.error('Failed to restore checkpoint');
    }
  }, [handleFilesChange, messages, project.id]);

  const handleRetry = useCallback(async (checkpointId: string, messageIndex: number) => {
    try {
      // First check if checkpoint exists
      const exists = await checkpointManager.checkpointExists(checkpointId);
      if (!exists) {
        toast.error('Checkpoint no longer exists - cannot retry');
        logger.warn(`[Workspace] Checkpoint ${checkpointId} no longer exists`);
        return;
      }
      
      // Find the user message that preceded this assistant message
      let userMessage = null;
      for (let i = messageIndex - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          userMessage = messages[i];
          break;
        }
      }
      
      if (!userMessage) {
        toast.error('Cannot find original user message to retry');
        return;
      }
      
      // Restore the checkpoint first
      const success = await saveManager.runWithSuppressedDirty(project.id, () =>
        checkpointManager.restoreCheckpoint(checkpointId)
      );
      if (!success) {
        toast.error('Failed to restore checkpoint');
        return;
      }

      const savedId = saveManager.getSavedCheckpointId(project.id);
      if (savedId && savedId === checkpointId) {
        saveManager.markClean(project.id);
        const latestProject = await vfs.getProject(project.id);
        setLastSavedAt(latestProject.lastSavedAt ?? null);
      } else {
        saveManager.markDirty(project.id);
      }
      
      // Record the retry action
      await conversationState.recordConversationBreak(project.id, {
        type: 'retry',
        timestamp: new Date().toISOString(),
        checkpointId,
        description: `Retrying: "${userMessage.content.substring(0, 50)}..."`
      });
      
      const messagesBeforeRetry = messages.slice(0, messageIndex - 1);
      setMessages(messagesBeforeRetry);
      
      // Update conversation state with truncated messages
      const orchestratorMessages = ConversationConverter.convertToOrchestratorMessages(messagesBeforeRetry);
      await conversationState.updateConversation(project.id, orchestratorMessages);
      
      // Add context message about the retry (for the LLM)
      await conversationState.addBreakContextMessage(project.id, {
        type: 'retry',
        timestamp: new Date().toISOString(),
        checkpointId,
        description: `Retrying after restoring to checkpoint`
      });
      
      // Show success message briefly
      toast.success('Restored checkpoint and retrying...');
      handleFilesChange();
      
      // Set the prompt and trigger retry
      setPrompt(userMessage.content);
      
      // Trigger a click event on the generate button after a brief delay to ensure state update
      setTimeout(() => {
        const generateButton = document.querySelector('[data-retry-trigger="true"]') as HTMLButtonElement;
        if (generateButton) {
          generateButton.click();
        }
      }, 100);
      
    } catch (error) {
      logger.error('Error during retry:', error);
      toast.error('Failed to retry');
    }
  }, [messages, handleFilesChange, project.id]);

  
  const handleGenerate = async () => {
    if (isTourLockingInput) {
      return;
    }

    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      toast.error('Please enter a prompt');
      return;
    }

    const currentProvider = configManager.getSelectedProvider();
    const providerConfig = getProvider(currentProvider);
    const apiKey = configManager.getApiKey();
    
    // Only require API key for providers that need it
    if (providerConfig.apiKeyRequired && !apiKey) {
      toast.error(`Please set your ${providerConfig.name} API key in settings`);
      return;
    }
    
    // For local providers, check if they have models available
    if (providerConfig.isLocal) {
      const currentModel = configManager.getProviderModel(currentProvider);
      if (!currentModel) {
        toast.error(`No model selected for ${providerConfig.name}. Please select a model in settings.`);
        return;
      }
    }

    isAutoScrollEnabled.current = true;
    isUserScrolling.current = false;

    setGenerating(true);
    const messageContent = focusContext 
      ? `${formatFocusContextBlock(focusContext)}\n\n${trimmedPrompt}`
      : trimmedPrompt;

    const userMessage = { id: makeId(), role: 'user' as const, content: messageContent } as Message;
    setMessages(prev => [...prev, userMessage]);

    try {
      // Prepare a dedicated assistant bubble for streaming
      currentAssistantIdx.current = null;
      setMessages(prev => ensureStreamingAssistant([...prev]).arr);

      // Get existing conversation for context
      const existingConversation = await conversationState.getConversationMessages(project.id, 50); // Max 50 messages for context
      
      // **CRITICAL BUG FIX**: Validate UI/Context synchronization
      const currentUIMessages = messages.length;
      const contextMessages = existingConversation.filter(m => m.role === 'user' || m.role === 'assistant').length;
      
      logger.debug(`[Workspace] Context validation:`, {
        uiMessages: currentUIMessages,
        contextMessages: contextMessages,
        totalContextIncludingSystem: existingConversation.length,
        contextTypes: existingConversation.map(m => m.role)
      });
      
      // If there's a mismatch, this indicates the ghost conversation bug
      if (currentUIMessages === 0 && contextMessages > 0) {
        logger.warn(`[Workspace] GHOST CONVERSATION DETECTED: UI has ${currentUIMessages} messages but context has ${contextMessages} messages!`);
        logger.warn(`[Workspace] This causes the LLM to continue previous conversations that the user cannot see.`);
        logger.warn(`[Workspace] Clearing context to match UI state...`);
        
        // Clear the conversation to fix the mismatch
        await conversationState.clearConversation(project.id);
        // Re-fetch the now-empty conversation
        existingConversation.length = 0;
      }
      
      // Get file tree for system prompt context
      let fileTree: string | undefined;
      try {
        const files = await vfs.listDirectory(project.id, '/');
        if (files.length > 0) {
          fileTree = files.map(f => f.path).join('\n');
        }
      } catch {
        // Ignore errors getting file tree
      }
      
      const systemPrompt = buildShellSystemPrompt(fileTree);
      
      const currentMessages = await new Promise<Message[]>(resolve => {
        setMessages(prev => {
          resolve(prev);
          return prev;
        });
      });
      
      // Prepare conversation with system prompt and context
      const conversationForOrchestrator = ConversationConverter.prepareConversationForOrchestrator(
        currentMessages, // Current UI messages including the new user message
        {
          maxMessages: 50,
          includeSystemPrompt: true,
          systemPrompt
        }
      );

      const orchestrator = new Orchestrator(
        project.id,
        conversationForOrchestrator,
          (message, step) => {
            if (message === 'assistant_delta' && ((step as any)?.text || (step as any)?.snapshot)) {
              const deltaText = (step as any).text as string | undefined;
              const snapshot = (step as any).snapshot as string | undefined;
              setMessages(prev => {
                let { arr, idx } = ensureStreamingAssistant([...prev]);
                if (idx < 0 || idx >= arr.length || !arr[idx]) {
                  logger.error('[assistant_delta] Invalid index or missing message:', { idx, arrayLength: arr.length });
                  return prev; // Don't update if index is invalid
                }
                const base = arr[idx];
                const msg: Message = { ...base, toolMessages: [...(base.toolMessages || [])] } as any;
                const tms = msg.toolMessages as ToolMessageItem[];
                if (tms.length === 0 || tms[tms.length - 1].type !== 'message') {
                  tms.push({ id: makeId(), type: 'message', content: '' });
                }
                const current = tms[tms.length - 1];
                if (snapshot !== undefined) {
                  current.content = snapshot;
                } else if (deltaText) {
                  current.content = (current.content || '') + deltaText;
                }
                arr[idx] = msg;
                return arr;
              });
            }
            if (message === 'toolCalls' && (step as any)?.toolCalls) {
              const calls = (step as any).toolCalls as any[];
              logger.debug(`[Workspace] Received ${calls.length} tool calls`);
              setMessages(prev => {
                let { arr, idx } = ensureStreamingAssistant([...prev]);
                const base = arr[idx];
                const msg: Message = { ...base, toolMessages: [...(base.toolMessages || [])] } as any;
                const tms = msg.toolMessages as ToolMessageItem[];
                for (let i = 0; i < calls.length; i++) {
                  const c = calls[i];
                  const name = c.function?.name || c.name || '';
                  let parameters;
                  try {
                    parameters = c.function ? JSON.parse(c.function.arguments || '{}') : c.parameters;
                  } catch {
                    // Handle non-JSON arguments like patch strings
                    parameters = c.function ? { arguments: c.function.arguments } : c.parameters;
                  }
                  tms.push({ 
                    id: makeId(), 
                    type: 'tool', 
                    name: name,
                    parameters: parameters, 
                    status: 'pending', 
                    result: null 
                  } as ToolMessageItem);
                }
              arr[idx] = msg;
              return arr;
            });
          }
            if (message === 'usage' && (step as any)?.usage) {
              setMessages(prev => {
                if (currentAssistantIdx.current == null) return prev;
                const arr = [...prev];
                const base = arr[currentAssistantIdx.current];
                arr[currentAssistantIdx.current] = {
                  ...base,
                  cost: (step as any).totalCost,
                  usage: (step as any).usage,
                } as any;
                return arr;
              });
            }
            if (message === 'evaluation' && (step as any)?.summary) {
              const summary = (step as any).summary as string;
              setMessages(prev => {
                let { arr, idx } = ensureStreamingAssistant([...prev]);
                const base = arr[idx];
                const msg: Message = { ...base, toolMessages: [...(base.toolMessages || [])] } as any;
                (msg.toolMessages as ToolMessageItem[]).push({ id: makeId(), type: 'message', content: summary });
                arr[idx] = msg;
                return arr;
              });
            }
            if (message === 'divider') {
              setMessages(prev => {
                let { arr, idx } = ensureStreamingAssistant([...prev]);
                const base = arr[idx];
                const msg: Message = { ...base, toolMessages: [...(base.toolMessages || [])] } as any;
                (msg.toolMessages as ToolMessageItem[]).push({ id: makeId(), type: 'divider', title: (step as any)?.title || 'Section' });
                arr[idx] = msg;
                return arr;
              });
            }
            if (message === 'tool_result' && step) {
              const { toolIndex, result } = step as any;
              logger.debug(`[Workspace] Received tool result for tool ${toolIndex}`, { resultPreview: typeof result === 'string' ? result.substring(0, 100) : result });
              setMessages(prev => {
                let { arr, idx } = ensureStreamingAssistant([...prev]);
                const base = arr[idx];
                const msg: Message = { ...base, toolMessages: [...(base.toolMessages || [])] } as any;
                const tms = msg.toolMessages as ToolMessageItem[];
                
                // Find the most recent tool message and update its result
                // Since toolIndex from orchestrator might not match accumulated list, update the last tool
                for (let i = tms.length - 1; i >= 0; i--) {
                  if (tms[i].type === 'tool' && !tms[i].result) {
                    tms[i] = { ...tms[i], result: result };
                    break;
                  }
                }
                
                arr[idx] = msg;
                return arr;
              });
            }
            if (message === 'tool_status' && step) {
              const { toolIndex, status, result, error } = step as any;
              setMessages(prev => {
                let { arr, idx } = ensureStreamingAssistant([...prev]);
                const base = arr[idx];
                const msg: Message = { ...base, toolMessages: [...(base.toolMessages || [])] } as any;
                const tms = msg.toolMessages as ToolMessageItem[];
                
                // Find the most recent tool message to update its status
                for (let i = tms.length - 1; i >= 0; i--) {
                  if (tms[i].type === 'tool' && (tms[i].status === 'pending' || tms[i].status === 'executing')) {
                    tms[i] = {
                      ...tms[i],
                      status: status,
                      result: result || error || tms[i].result
                    };
                    break;
                  }
                }
                
                arr[idx] = msg;
                return arr;
              });
            }
          }
        );

        // Store orchestrator reference for stop functionality
        setCurrentOrchestrator(orchestrator);
        
        const result = await orchestrator.execute(messageContent);
        
        // Attach checkpoint and usage to the current streamed assistant message
        setMessages(prev => {
          if (currentAssistantIdx.current == null) return prev;
          const arr = [...prev];
          const base = arr[currentAssistantIdx.current];
          arr[currentAssistantIdx.current] = {
            ...base,
            checkpointId: result.checkpointId,
            cost: result.totalCost,
            usage: result.usageInfo,
          } as any;
          return arr;
        });

        if (result.success) {
          handleFilesChange();
        }
        
        // Persist the updated conversation to IndexedDB after generation
        const finalMessages = await new Promise<Message[]>((resolve) => {
          setMessages(prev => {
            resolve(prev);
            return prev;
          });
        });
        
        const orchestratorMessages = ConversationConverter.convertToOrchestratorMessages(finalMessages);
        await conversationState.updateConversation(project.id, orchestratorMessages);
        
        setPrompt('');
    } catch (error) {
      logger.error('Generation error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to generate');
      setMessages(prev => [...prev, { 
        id: makeId(),
        role: 'assistant', 
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` 
      } as any]);
    } finally {
      setGenerating(false);
      setCurrentOrchestrator(null);
      currentAssistantIdx.current = null;
    }
  };

  const handleStop = useCallback(() => {
    if (currentOrchestrator) {
      currentOrchestrator.stop();
      toast.info('Generation stopped');
    }
  }, [currentOrchestrator]);

  const headerActions: HeaderAction[] = [
    {
      id: 'back',
      label: 'Back to projects',
      icon: ArrowLeft,
      onClick: onBack,
      variant: 'outline'
    }
  ];

  headerActions.push({
    id: 'save',
    label: saveInProgress ? 'Saving…' : isDirty ? 'Save' : 'Saved',
    icon: Save,
    onClick: handleSave,
    variant: isDirty ? 'default' : 'outline',
    disabled: !isDirty || saveInProgress
  });

  if (initialCheckpointId) {
    headerActions.push({
      id: 'discard',
      label: 'Discard Changes',
      icon: RotateCcw,
      onClick: () => handleRestoreCheckpoint(initialCheckpointId, 'Last saved state'),
      variant: 'outline',
      disabled: saveInProgress || !isDirty,
      dataTourId: 'discard-changes-button'
    });
  }


  // Add desktop-only settings button
  const desktopSettingsButton = (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-3 flex items-center gap-2"
          title="Project cost and settings"
        >
          {shouldShowCosts && (
            <span className="text-sm font-medium">
              ${projectCost.toFixed(3)}
            </span>
          )}
          <Settings className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96" align="end">
        <SettingsPanel />
      </PopoverContent>
    </Popover>
  );

  const mobileMenuContent = (
    <div className="space-y-2">
      {shouldShowCosts && (
        <div className="pb-2 border-b border-border/50">
          <span className="text-sm font-medium">
            Project cost: ${projectCost.toFixed(projectCost >= 10 ? 2 : 3)}
          </span>
        </div>
      )}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start"
          >
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[calc(100vw-2rem)]" align="start">
          <SettingsPanel />
        </PopoverContent>
      </Popover>
    </div>
  );

  return (
    <TooltipProvider>
      <div className="h-screen flex flex-col">
        {/* Header */}
        <AppHeader
          leftText={project.name}
          onLogoClick={onBack}
          actions={headerActions}
          mobileMenuContent={mobileMenuContent}
          desktopOnlyContent={desktopSettingsButton}
        />

        {/* Desktop Workspace */}
        <div className="hidden md:flex flex-1 overflow-hidden bg-background">
          {/* Left sidebar for panel toggles */}
          <div className="w-10 bg-muted/70 border-r border-border flex flex-col items-center py-3 gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={`h-5 w-5 px-1 rounded-sm flex items-center justify-center transition-all ${
                    showAssistant 
                      ? 'shadow-sm' 
                      : 'bg-transparent text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                  }`}
                  style={{
                    backgroundColor: showAssistant ? 'var(--button-assistant-active)' : undefined,
                    color: showAssistant ? 'white' : undefined
                  }}
                  onClick={() => setShowAssistant(!showAssistant)}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent 
                side="right" 
                className="border-0"
                style={{ 
                  backgroundColor: 'var(--button-assistant-active)', 
                  color: 'white'
                }}
                arrowStyle={{
                  backgroundColor: 'var(--button-assistant-active)',
                  fill: 'var(--button-assistant-active)'
                }}
              >
                <p>Chat</p>
              </TooltipContent>
            </Tooltip>
            
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={`h-5 w-5 px-1 rounded-sm flex items-center justify-center transition-all ${
                    showFiles 
                      ? 'shadow-sm' 
                      : 'bg-transparent text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                  }`}
                  style={{
                    backgroundColor: showFiles ? 'var(--button-files-active)' : undefined,
                    color: showFiles ? 'white' : undefined
                  }}
                  onClick={() => setShowFiles(!showFiles)}
                >
                  <FolderTree className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent 
                side="right" 
                className="border-0"
                style={{ 
                  backgroundColor: 'var(--button-files-active)', 
                  color: 'white'
                }}
                arrowStyle={{
                  backgroundColor: 'var(--button-files-active)',
                  fill: 'var(--button-files-active)'
                }}
              >
                <p>File Explorer</p>
              </TooltipContent>
            </Tooltip>
            
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={`h-5 w-5 px-1 rounded-sm flex items-center justify-center transition-all ${
                    showEditor 
                      ? 'shadow-sm' 
                      : 'bg-transparent text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                  }`}
                  style={{
                    backgroundColor: showEditor ? 'var(--button-editor-active)' : undefined,
                    color: showEditor ? 'white' : undefined
                  }}
                  onClick={() => setShowEditor(!showEditor)}
                >
                  <Code2 className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent 
                side="right" 
                className="border-0"
                style={{ 
                  backgroundColor: 'var(--button-editor-active)', 
                  color: 'white'
                }}
                arrowStyle={{
                  backgroundColor: 'var(--button-editor-active)',
                  fill: 'var(--button-editor-active)'
                }}
              >
                <p>Code Editor</p>
              </TooltipContent>
            </Tooltip>
            
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={`h-5 w-5 mx-1 rounded-sm flex items-center justify-center transition-all ${
                    showPreview 
                      ? 'shadow-sm' 
                      : 'bg-transparent text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                  }`}
                  style={{
                    backgroundColor: showPreview ? 'var(--button-preview-active)' : undefined,
                    color: showPreview ? 'white' : undefined
                  }}
                  onClick={() => setShowPreview(!showPreview)}
                >
                  <Eye className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent 
                side="right" 
                className="border-0"
                style={{ 
                  backgroundColor: 'var(--button-preview-active)', 
                  color: 'white'
                }}
                arrowStyle={{
                  backgroundColor: 'var(--button-preview-active)',
                  fill: 'var(--button-preview-active)'
                }}
              >
                <p>Preview</p>
              </TooltipContent>
            </Tooltip>
          </div>
          
          {/* Main content area */}
          <div className="flex-1 p-2 overflow-hidden" data-tour-id="workspace-panels">
          <ResizablePanelGroup direction="horizontal" autoSaveId="workspace-layout">
            {/* Column 1: AI Assistant */}
            {showAssistant && (
              <ResizablePanel 
                id="assistant"
                order={1}
                defaultSize={defaultSizes.assistant} 
                minSize={15}
              >
                <div
                  className="h-full flex flex-col border border-border rounded-lg shadow-sm overflow-hidden relative"
                  style={{ background: `linear-gradient(var(--panel-assistant-tint), var(--panel-assistant-tint)), var(--card)` }}
                  data-tour-id="assistant-panel"
                >
                      <div className="p-3 border-b bg-muted/80 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <MessageSquare 
                            className="h-4 w-4 md:hidden" 
                            style={{ color: 'var(--button-assistant-active)' }} 
                          />
                          <button
                            type="button"
                            onClick={() => setShowAssistant(false)}
                            aria-label="Hide chat"
                            className="relative hidden h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-destructive md:flex group"
                          >
                            <MessageSquare 
                              className="h-4 w-4 transition-opacity group-hover:opacity-0" 
                              style={{ color: 'var(--button-assistant-active)' }} 
                            />
                            <X className="absolute h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                          </button>
                          <h3 className="text-sm font-medium">Chat</h3>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            logger.debug(`[Workspace] Clearing chat - UI has ${messages.length} messages`);
                            
                            // Clear UI state first
                            setMessages([]);
                            
                            // Clear persistent conversation state
                            await conversationState.clearConversation(project.id);
                            
                            // Verify clearing worked
                            const verifyConversation = await conversationState.getConversationMessages(project.id);
                            if (verifyConversation.length > 0) {
                              logger.error(`[Workspace] Clear failed! Still has ${verifyConversation.length} messages in storage`);
                            } else {
                              logger.debug(`[Workspace] Successfully cleared all conversation data for project ${project.id}`);
                            }
                          }}
                          className="h-5 w-5 p-0"
                          title="Clear chat"
                          data-tour-id="clear-chat-button"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      
                      {/* Messages */}
                      <div 
                        ref={messagesContainerRef}
                        onScroll={handleScroll}
                        className="flex-1 overflow-y-auto p-4 space-y-3 flex flex-col"
                        data-tour-id="checkpoint-panel"
                      >
                        {messages.length === 0 ? (
                          <div className="flex-1 flex items-center justify-center">
                            <div className="text-center space-y-3">
                              <MessageSquare className="h-12 w-12 mx-auto opacity-50 text-muted-foreground" />
                              <div className="space-y-1">
                                <p className="text-base font-medium text-foreground">Ready to build</p>
                                <p className="text-sm text-muted-foreground">Describe what you want to create or change</p>
                              </div>
                            </div>
                          </div>
                        ) : (
                          messages.map((msg, i) => {
                            
                            if (msg.isTask && msg.taskSteps) {
                              return (
                                <div key={msg.id} className="bg-card border border-border p-3 rounded-lg text-sm">
                                  <TaskProgressDisplay
                                    title={msg.taskTitle || 'Task Progress'}
                                    steps={msg.taskSteps}
                                    checkpointId={msg.checkpointId}
                                    onRestore={(id) => handleRestoreCheckpoint(id, 'task checkpoint')}
                                    isSavedCheckpoint={msg.checkpointId === initialCheckpointId}
                                    expanded={expandedTasks.has(i)}
                                    onToggleExpand={() => {
                                      const newExpanded = new Set(expandedTasks);
                                      if (newExpanded.has(i)) {
                                        newExpanded.delete(i);
                                      } else {
                                        newExpanded.add(i);
                                      }
                                      setExpandedTasks(newExpanded);
                                    }}
                                  />
                                </div>
                              );
                            }
                            
                            if (
                              msg.role === 'assistant' && (
                                (msg as any).toolMessages && (msg as any).toolMessages.length > 0 ||
                                (msg as any).toolCalls && (msg as any).toolCalls.length > 0
                              )
                            ) {
                              return (
                                <div key={msg.id} className="bg-card border border-border p-3 rounded-lg text-sm mr-2">
                                  <div className="mb-2">
                                    <p className="font-medium">AI</p>
                                  </div>
                                  <AssistantMessage
                                    content={msg.content}
                                    toolCalls={(msg as any).toolCalls}
                                    toolMessages={(msg as any).toolMessages}
                                    checkpointId={msg.checkpointId}
                                    onRestore={msg.checkpointId ? (id) => handleRestoreCheckpoint(id, 'checkpoint') : undefined}
                                    onRetry={msg.checkpointId ? (id) => handleRetry(id, i) : undefined}
                                    isSavedCheckpoint={msg.checkpointId === initialCheckpointId}
                                    isExecuting={generating}
                                    cost={(msg as any).cost}
                                    usage={(msg as any).usage}
                                  />
                                </div>
                              );
                            }
                            
                            return (
                              <div
                                key={msg.id}
                                className={`p-3 rounded-lg text-sm ${
                                  msg.role === 'user' 
                                    ? 'bg-muted/50 ml-8' 
                                    : 'bg-card border border-border mr-2'
                                }`}
                              >
                                <div className="mb-1">
                                  <p className="font-medium">
                                    {msg.role === 'user' ? 'You' : 'AI'}
                                  </p>
                                </div>
                                <MarkdownRenderer content={msg.content} />
                              </div>
                            );
                          })
                        )}
                        {/* Invisible anchor for scrolling to bottom */}
                        <div ref={messagesEndRef} />
                      </div>

                      {/* Input */}
                      <div className="p-3 space-y-2">
                        {focusContextHint}
                        {/* Input Area */}
                        <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
                          <div className="relative flex bg-card rounded-lg transition-all">
                            <Textarea
                              value={prompt}
                              onChange={(e) => setPrompt(e.target.value)}
                              onKeyDown={(e) => {
                                if (isTourLockingInput) {
                                  return;
                                }
                                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                  e.preventDefault();
                                  handleGenerate();
                                }
                              }}
                              placeholder="Describe what you want to build..."
                              className="flex-1 px-3 py-2 bg-transparent border-0 resize-none focus:outline-none text-sm placeholder:text-muted-foreground text-foreground"
                              rows={3}
                              disabled={generating || isTourLockingInput}
                            />
                            <div className="flex flex-col p-2 gap-2">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    onClick={generating ? handleStop : handleGenerate}
                                    disabled={isTourLockingInput ? !generating : (!generating && !prompt.trim())}
                                    size="sm"
                                    className="flex items-center gap-2"
                                    data-retry-trigger="true"
                                  >
                                    {generating ? (
                                      <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Stop
                                      </>
                                    ) : (
                                      <>
                                        <Send className="h-4 w-4" />
                                        Send
                                      </>
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="left">
                                  <div className="space-y-1">
                                    <p className="text-xs">
                                      <kbd className="text-xs bg-muted px-1 py-0.5 rounded">Ctrl/Cmd+Enter</kbd> to send
                                    </p>
                                    <p className="text-xs">
                                      <kbd className="text-xs bg-muted px-1 py-0.5 rounded">Enter</kbd> for newline
                                    </p>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                              {prompt.length > 0 && (
                                <div className="px-3 py-1.5 bg-muted text-muted-foreground rounded-md text-xs text-center">
                                  {prompt.length} chars
                                </div>
                              )}
                            </div>
                          </div>
                          
                          {/* Footer */}
                          <div className="border-t border-border bg-muted/50 px-2 py-2">
                            <div className="flex items-center justify-between">
                            {/* Model selector and settings combined */}
                            <Popover open={showDesktopSettings} onOpenChange={setShowDesktopSettings}>
                              <PopoverTrigger asChild>
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  className="h-7 text-xs"
                                  data-tour-id="provider-settings-trigger"
                                >
                                  <span>{getModelDisplayName(currentModel)}</span>
                                  {showDesktopSettings ? (
                                    <ChevronDown className="h-3 w-3 ml-1" />
                                  ) : (
                                    <ChevronUp className="h-3 w-3 ml-1" />
                                  )}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-96" align="start">
                                <ModelSettingsPanel 
                                  onClose={() => setShowDesktopSettings(false)}
                                  onModelChange={(modelId) => setCurrentModel(modelId)}
                                />
                              </PopoverContent>
                            </Popover>

                          </div>
                          </div>
                        </div>
                      </div>
                    </div>
                </ResizablePanel>
            )}
            {showAssistant && (showFiles || showEditor || showPreview) && (
              <ResizableHandle withHandle />
            )}

            {/* Column 2: File Explorer */}
            {showFiles && (
              <ResizablePanel 
                id="files"
                order={2}
                defaultSize={defaultSizes.files} 
                minSize={14}
              >
                <div className="h-full border border-border rounded-lg shadow-sm overflow-hidden relative" style={{ background: `linear-gradient(0deg, rgba(var(--panel-files-rgb), 0.01), rgba(var(--panel-files-rgb), 0.01)), var(--card)` }}>
                      <FileExplorer
                        projectId={project.id}
                        onFileSelect={handleFileSelect}
                        onClose={() => setShowFiles(false)}
                      />
                    </div>
                </ResizablePanel>
            )}
            {showFiles && (showEditor || showPreview) && (
              <ResizableHandle withHandle />
            )}

            {/* Column 3: Code Editor */}
            {showEditor && (
              <ResizablePanel 
                id="editor"
                order={3}
                defaultSize={defaultSizes.editor} 
                minSize={20}
              >
                <div className="h-full border border-border rounded-lg shadow-sm overflow-hidden relative" style={{ background: `linear-gradient(0deg, rgba(var(--panel-editor-rgb), 0.01), rgba(var(--panel-editor-rgb), 0.01)), var(--card)` }}>
                      <MultiTabEditor
                        projectId={project.id}
                        onFilesChange={handleFilesChange}
                        onClose={() => setShowEditor(false)}
                      />
                    </div>
                </ResizablePanel>
            )}
            {showEditor && showPreview && (
              <ResizableHandle withHandle />
            )}

            {/* Column 4: Preview */}
            {showPreview && (
              <ResizablePanel 
                id="preview"
                order={4}
                defaultSize={defaultSizes.preview} 
                minSize={20}
              >
                <div className="h-full border border-border rounded-lg shadow-sm overflow-hidden relative" style={{ background: `linear-gradient(0deg, rgba(var(--panel-preview-rgb), 0.01), rgba(var(--panel-preview-rgb), 0.01)), var(--card)` }}>
                      <MultipagePreview
                        projectId={project.id}
                        refreshTrigger={refreshTrigger}
                        onFocusSelection={handleFocusSelection}
                        hasFocusTarget={Boolean(focusContext)}
                        onClose={() => setShowPreview(false)}
                      />
                    </div>
                </ResizablePanel>
            )}
          </ResizablePanelGroup>
          </div>
        </div>

        {/* Mobile Workspace */}
        <div className="flex md:hidden flex-1 overflow-hidden bg-background flex-col">
          {/* Single active panel */}
          <div className="flex-1 p-2 pb-16 overflow-hidden">
            {activeMobilePanel === 'assistant' && (
              <div className="h-full flex flex-col border border-border rounded-lg shadow-sm overflow-hidden relative" style={{ background: `linear-gradient(var(--panel-assistant-tint), var(--panel-assistant-tint)), var(--card)` }}>
                <div className="p-3 border-b bg-muted/80 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" style={{ color: 'var(--button-assistant-active)' }} />
                    <h3 className="text-sm font-medium">Chat</h3>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      logger.debug(`[Workspace] Clearing chat - UI has ${messages.length} messages`);
                      setMessages([]);
                      await conversationState.clearConversation(project.id);
                    }}
                    className="h-5 w-5 p-0"
                    title="Clear chat"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                
                {/* Messages */}
                <div 
                  ref={messagesContainerRef}
                  onScroll={handleScroll}
                  className="flex-1 overflow-auto p-2 space-y-2"
                >
                  {messages.map((msg, i) => {
                    if (msg.isTask && msg.taskSteps) {
                      return (
                        <div key={msg.id} className="border border-border rounded-lg p-3 bg-card">
                          <div className="flex items-center justify-between mb-2">
                            <p className="font-medium text-sm">Task Progress</p>
                            {msg.checkpointId && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleRestoreCheckpoint(msg.checkpointId!, 'checkpoint')}
                                className="h-6 px-2 text-xs"
                                title="Restore to this checkpoint"
                              >
                                <RotateCcw className="h-3 w-3 mr-1" />
                                Restore
                              </Button>
                            )}
                          </div>
                          <AssistantMessage
                            content={msg.content}
                            toolCalls={(msg as any).toolCalls}
                            toolMessages={(msg as any).toolMessages}
                            checkpointId={msg.checkpointId}
                            onRestore={msg.checkpointId ? (id) => handleRestoreCheckpoint(id, 'checkpoint') : undefined}
                            onRetry={msg.checkpointId ? (id) => handleRetry(id, i) : undefined}
                            isSavedCheckpoint={msg.checkpointId === initialCheckpointId}
                            isExecuting={generating}
                            cost={(msg as any).cost}
                            usage={(msg as any).usage}
                          />
                        </div>
                      );
                    }
                    
                    // Handle assistant messages with tool calls/messages (streaming support)
                    if (
                      msg.role === 'assistant' && (
                        (msg as any).toolMessages && (msg as any).toolMessages.length > 0 ||
                        (msg as any).toolCalls && (msg as any).toolCalls.length > 0
                      )
                    ) {
                      return (
                        <div key={msg.id} className="bg-card border border-border p-3 rounded-lg text-sm mr-2">
                          <div className="mb-2">
                            <p className="font-medium">AI</p>
                          </div>
                          <AssistantMessage
                            content={msg.content}
                            toolCalls={(msg as any).toolCalls}
                            toolMessages={(msg as any).toolMessages}
                            checkpointId={msg.checkpointId}
                            onRestore={msg.checkpointId ? (id) => handleRestoreCheckpoint(id, 'checkpoint') : undefined}
                            onRetry={msg.checkpointId ? (id) => handleRetry(id, i) : undefined}
                            isSavedCheckpoint={msg.checkpointId === initialCheckpointId}
                            isExecuting={generating}
                            cost={(msg as any).cost}
                            usage={(msg as any).usage}
                          />
                        </div>
                      );
                    }
                    
                    return (
                      <div
                        key={msg.id}
                        className={`p-3 rounded-lg text-sm ${
                          msg.role === 'user' 
                            ? 'bg-muted/50 ml-8' 
                            : 'bg-card border border-border mr-2'
                        }`}
                      >
                        <div className="mb-1">
                          <p className="font-medium">
                            {msg.role === 'user' ? 'You' : 'AI'}
                          </p>
                        </div>
                        <MarkdownRenderer content={msg.content} />
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="p-3 space-y-2">
                  {focusContextHint}
                  <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
                    <div className="relative flex bg-card rounded-lg transition-all">
                      <Textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyDown={(e) => {
                          if (isTourLockingInput) {
                            return;
                          }
                          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault();
                            handleGenerate();
                          }
                        }}
                        placeholder="Describe what you want to build..."
                        className="flex-1 px-3 py-2 bg-transparent border-0 resize-none focus:outline-none text-sm placeholder:text-muted-foreground text-foreground"
                        rows={3}
                        disabled={generating || isTourLockingInput}
                      />
                      <div className="flex flex-col p-2 gap-2">
                        <Button
                          onClick={generating ? handleStop : handleGenerate}
                          disabled={isTourLockingInput ? !generating : (!generating && !prompt.trim())}
                          size="sm"
                          className="flex items-center gap-2"
                        >
                          {generating ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Stop
                            </>
                          ) : (
                            <>
                              <Send className="h-4 w-4" />
                              Send
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                    
                    {/* Footer */}
                    <div className="border-t border-border bg-muted/50 px-2 py-2">
                      <Popover open={showMobileSettings} onOpenChange={setShowMobileSettings}>
                        <PopoverTrigger asChild>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-7 text-xs"
                            data-tour-id="provider-settings-trigger"
                          >
                            <span>{getModelDisplayName(currentModel)}</span>
                            {showMobileSettings ? (
                              <ChevronDown className="h-3 w-3 ml-1" />
                            ) : (
                              <ChevronUp className="h-3 w-3 ml-1" />
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[calc(100vw-2rem)]" align="start">
                          <ModelSettingsPanel 
                            onClose={() => setShowMobileSettings(false)}
                            onModelChange={(modelId) => setCurrentModel(modelId)}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeMobilePanel === 'files' && (
              <div className="h-full border border-border rounded-lg shadow-sm overflow-hidden relative" style={{ background: `linear-gradient(0deg, rgba(var(--panel-files-rgb), 0.01), rgba(var(--panel-files-rgb), 0.01)), var(--card)` }}>
                <FileExplorer
                  projectId={project.id}
                  onFileSelect={handleFileSelect}
                  onClose={() => setShowFiles(false)}
                />
              </div>
            )}

            {activeMobilePanel === 'editor' && (
              <div className="h-full border border-border rounded-lg shadow-sm overflow-hidden relative" style={{ background: `linear-gradient(0deg, rgba(var(--panel-editor-rgb), 0.01), rgba(var(--panel-editor-rgb), 0.01)), var(--card)` }}>
                <MultiTabEditor
                  projectId={project.id}
                  onFilesChange={handleFilesChange}
                  onClose={() => setShowEditor(false)}
                />
              </div>
            )}

            {activeMobilePanel === 'preview' && (
              <div className="h-full border border-border rounded-lg shadow-sm overflow-hidden relative" style={{ background: `linear-gradient(0deg, rgba(var(--panel-preview-rgb), 0.01), rgba(var(--panel-preview-rgb), 0.01)), var(--card)` }}>
                <MultipagePreview
                  projectId={project.id}
                  refreshTrigger={refreshTrigger}
                  onFocusSelection={handleFocusSelection}
                  hasFocusTarget={Boolean(focusContext)}
                  onClose={() => setShowPreview(false)}
                />
              </div>
            )}
          </div>

          {/* Bottom Navigation Bar */}
          <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border">
            <div className="flex justify-center items-center p-2 gap-2">
              <button
                className={`flex items-center justify-center py-2 px-2 rounded-lg transition-all shadow-sm ${
                  activeMobilePanel === 'assistant'
                    ? 'text-white'
                    : 'bg-transparent text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                }`}
                style={{
                  backgroundColor: activeMobilePanel === 'assistant' ? 'var(--button-assistant-active)' : undefined,
                }}
                onClick={() => setActiveMobilePanel('assistant')}
              >
                <MessageSquare className="h-4 w-4" />
              </button>
              
              <button
                className={`flex items-center justify-center py-2 px-2 rounded-lg transition-all shadow-sm ${
                  activeMobilePanel === 'files'
                    ? 'text-white'
                    : 'bg-transparent text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                }`}
                style={{
                  backgroundColor: activeMobilePanel === 'files' ? 'var(--button-files-active)' : undefined,
                }}
                onClick={() => setActiveMobilePanel('files')}
              >
                <FolderTree className="h-4 w-4" />
              </button>
              
              <button
                className={`flex items-center justify-center py-2 px-2 rounded-lg transition-all shadow-sm ${
                  activeMobilePanel === 'editor'
                    ? 'text-white'
                    : 'bg-transparent text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                }`}
                style={{
                  backgroundColor: activeMobilePanel === 'editor' ? 'var(--button-editor-active)' : undefined,
                }}
                onClick={() => setActiveMobilePanel('editor')}
              >
                <Code2 className="h-4 w-4" />
              </button>
              
              <button
                className={`flex items-center justify-center py-2 px-2 rounded-lg transition-all shadow-sm ${
                  activeMobilePanel === 'preview'
                    ? 'text-white'
                    : 'bg-transparent text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                }`}
                style={{
                  backgroundColor: activeMobilePanel === 'preview' ? 'var(--button-preview-active)' : undefined,
                }}
                onClick={() => setActiveMobilePanel('preview')}
              >
                <Eye className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
      <GuidedTourOverlay location="workspace" />
      <GuidedTourOverlay location="settings" />
    </TooltipProvider>
  );
}

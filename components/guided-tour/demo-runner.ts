import { v4 as uuidv4 } from 'uuid';
import { vfs } from '@/lib/vfs';
import { checkpointManager } from '@/lib/vfs/checkpoint';
import { saveManager } from '@/lib/vfs/save-manager';
import { GuidedTourTranscriptEvent } from './types';

const DEFAULT_DELAY = 200;

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new Error('aborted'));
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (signal?.aborted) {
        reject(new Error('aborted'));
        return;
      }
      resolve();
    }, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(new Error('aborted'));
    }, { once: true });
  });
}

function toTranscriptId(): string {
  try {
    return uuidv4();
  } catch {
    return `evt-${Date.now()}-${Math.random()}`;
  }
}

function renderCssSnippet(css: string): string {
  const lines = css.split('\n');
  const start = Math.max(0, lines.findIndex(line => line.includes('--primary')) - 1);
  return lines.slice(start, start + 6).join('\n');
}

export interface RunDemoEditOptions {
  projectId: string;
  delayMs?: number;
  emit: (event: GuidedTourTranscriptEvent) => void;
  signal?: AbortSignal;
  onWorkspaceEvent?: (event: GuidedTourTranscriptEvent) => void;
}

export interface RunDemoEditResult {
  preChangeCheckpointId: string | null;
  postChangeCheckpointId: string | null;
  originalCss: string | null;
  updatedCss: string | null;
}

export interface RunDemoFocusOptions {
  delayMs?: number;
  signal?: AbortSignal;
}

export async function runGuidedFocusDemo({
  delayMs = DEFAULT_DELAY,
  signal,
}: RunDemoFocusOptions): Promise<void> {
  // The tour overlay will highlight the crosshair button via the target selector
  // We just need to wait a moment for the visual effect
  await wait(2000, signal);
}

export async function runGuidedDemoEdit({
  projectId,
  delayMs = DEFAULT_DELAY,
  emit,
  signal,
  onWorkspaceEvent,
}: RunDemoEditOptions): Promise<RunDemoEditResult> {
  await vfs.init();

  const result: RunDemoEditResult = {
    preChangeCheckpointId: null,
    postChangeCheckpointId: null,
    originalCss: null,
    updatedCss: null,
  };

  const cssFile = await vfs.readFile(projectId, '/styles/main.css');
  const cssContent = typeof cssFile.content === 'string' ? cssFile.content : '';
  result.originalCss = cssContent;

  const preCheckpoint = await checkpointManager.createCheckpoint(
    projectId,
    'Tour: before button color change',
    { kind: 'system' }
  );
  result.preChangeCheckpointId = preCheckpoint.id;

  const emitEvent = async (event: GuidedTourTranscriptEvent) => {
    const payload = { ...event, id: event.id || toTranscriptId() };
    emit(payload);
    onWorkspaceEvent?.(payload);
    await wait(delayMs, signal);
  };

  await emitEvent({
    id: toTranscriptId(),
    role: 'user',
    content: 'On the home page, change the background color of the button "Our Services" to green.',
  });

  await emitEvent({
    id: toTranscriptId(),
    role: 'assistant',
    tone: 'plan',
    content: 'Plan:\n1. Inspect the project structure.\n2. Review the CSS variables controlling accent colors.\n3. Update the primary palette to a green tone.\n4. Verify the change in the stylesheet.',
  });

  await emitEvent({
    id: toTranscriptId(),
    role: 'tool',
    name: 'shell',
    command: 'ls -R /',
    output: '/\n/about.html\n/contact.html\n/index.html\n/styles\n/styles/main.css\n/scripts\n/scripts/main.js',
  });

  await emitEvent({
    id: toTranscriptId(),
    role: 'assistant',
    tone: 'info',
    content: 'The landing page lives in /index.html and styling is centralized in /styles/main.css, so updating those CSS variables will recolor the buttons everywhere.',
  });

  await emitEvent({
    id: toTranscriptId(),
    role: 'tool',
    name: 'shell',
    command: 'cat /styles/main.css',
    output: renderCssSnippet(cssContent),
  });

  await emitEvent({
    id: toTranscriptId(),
    role: 'assistant',
    tone: 'info',
    content: 'The orange palette is defined by --primary and --primary-dark. I’ll replace those with green values.',
  });

  const updatedCss = cssContent
    .replace('--primary: #ea580c;', '--primary: #22c55e;')
    .replace('--primary-dark: #c2410c;', '--primary-dark: #16a34a;');

  result.updatedCss = updatedCss;

  await emitEvent({
    id: toTranscriptId(),
    role: 'tool',
    name: 'json_patch',
    command: 'update /styles/main.css (--primary → #22c55e)',
    output: 'Applied 2/2 operations to /styles/main.css. Updated primary palette to emerald green.',
  });

  if (cssContent !== updatedCss) {
    await vfs.updateFile(projectId, '/styles/main.css', updatedCss);
    saveManager.markDirty(projectId);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('filesChanged'));
    }
  }

  const postCheckpoint = await checkpointManager.createCheckpoint(
    projectId,
    'Tour: button color updated',
    { kind: 'auto', baseRevisionId: preCheckpoint.id }
  );
  result.postChangeCheckpointId = postCheckpoint.id;

  await emitEvent({
    id: toTranscriptId(),
    role: 'tool',
    name: 'shell',
    command: 'cat /styles/main.css',
    output: renderCssSnippet(updatedCss),
  });

  await emitEvent({
    id: toTranscriptId(),
    role: 'assistant',
    tone: 'success',
    content: 'The primary accent now uses a green palette. You can preview the change and save it if you prefer this style.',
    checkpointId: postCheckpoint.id,
  });

  return result;
}

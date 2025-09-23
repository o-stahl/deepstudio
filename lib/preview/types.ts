export interface ProcessedFile {
  path: string;
  content: string | ArrayBuffer;
  mimeType: string;
  blobUrl?: string;
}

export interface Route {
  path: string;
  file: string;
  title?: string;
}

export interface CompiledProject {
  entryPoint: string;
  files: ProcessedFile[];
  routes: Route[];
  blobUrls: Map<string, string>;
}

export interface FocusContextPayload {
  domPath: string;
  tagName: string;
  attributes: Record<string, string>;
  outerHTML: string;
}

export type PreviewMessage =
  | { type: 'navigate'; path: string }
  | { type: 'reload' }
  | { type: 'error'; error: string }
  | { type: 'selector-selection'; payload: FocusContextPayload }
  | { type: 'selector-cancelled' };

export type PreviewHostMessage = { type: 'selector-toggle'; active: boolean };

import { saveManager } from './save-manager';

export interface ProjectTemplate {
  name: string;
  description: string;
  files: Array<{
    path: string;
    content: string;
    isBase64?: boolean; // For binary files encoded as base64
  }>;
  directories: string[];
}

// Re-export all templates and utilities from the modular structure
export {
  DEMO_PROJECT_TEMPLATE,
  BAREBONES_PROJECT_TEMPLATE,
  createProjectFromTemplate,
  createDemoProjectWithAssets
} from './templates';
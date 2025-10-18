/**
 * Centralized registry for built-in templates
 * This is the single source of truth for all built-in templates in the system
 */

export interface BuiltInTemplateMetadata {
  id: string;
  name: string;
  description: string;
  isBuiltIn: true;
  updatedAt: Date;
  metadata?: {
    author?: string;
    tags?: string[];
  };
}

/**
 * Registry of all built-in templates
 * Add new templates here to make them available throughout the application
 */
export const BUILT_IN_TEMPLATES: BuiltInTemplateMetadata[] = [
  {
    id: 'blank',
    name: 'Blank',
    description: 'Minimal starting template with basic HTML/CSS/JS structure',
    isBuiltIn: true,
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    metadata: {
      author: 'OSW Studio',
      tags: ['starter', 'basic']
    }
  },
  {
    id: 'demo',
    name: 'Example Studios',
    description: 'Multi-page agency portfolio showcasing modern web development',
    isBuiltIn: true,
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    metadata: {
      author: 'OSW Studio',
      tags: ['portfolio', 'multi-page', 'example']
    }
  }
];

/**
 * Get a built-in template by ID
 */
export function getBuiltInTemplate(id: string): BuiltInTemplateMetadata | undefined {
  return BUILT_IN_TEMPLATES.find(t => t.id === id);
}

/**
 * Get all built-in template IDs
 */
export function getBuiltInTemplateIds(): string[] {
  return BUILT_IN_TEMPLATES.map(t => t.id);
}

import { v4 as uuidv4 } from 'uuid';
import JSZip from 'jszip';
import { CustomTemplate } from './types';
import { VFSDatabase } from './database';
import { logger } from '@/lib/utils';

const MAX_TEMPLATE_SIZE = 25 * 1024 * 1024; // 25MB
const MAX_THUMBNAIL_SIZE = 500 * 1024; // 500KB
const MAX_PREVIEW_IMAGE_SIZE = 1024 * 1024; // 1MB
const MAX_PREVIEW_IMAGES = 5;

export interface TemplateMetadata {
  name: string;
  description: string;
  version: string;
  author?: string;
  authorUrl?: string;
  license: string;
  licenseLabel?: string;
  licenseDescription?: string;
  tags?: string[];
  thumbnail?: string;
  previewImages?: string[];
  downloadUrl?: string;
}

export class TemplateService {
  private db: VFSDatabase;

  constructor() {
    this.db = new VFSDatabase();
  }

  async init(): Promise<void> {
    await this.db.init();
  }

  /**
   * Export a project as a template (.oswt file)
   */
  async exportProjectAsTemplate(
    vfs: any,
    projectId: string,
    metadata: TemplateMetadata
  ): Promise<Blob> {
    try {
      logger.info('[TemplateService] Exporting project as template', { projectId, name: metadata.name });

      // Validate metadata
      this.validateMetadata(metadata);

      // Get all files and directories from the project
      const items = await vfs.getAllFilesAndDirectories(projectId);

      // Separate files and directories
      const files = items.filter((item: any) => item.type !== 'directory');
      const directories = items
        .filter((item: any) => item.type === 'directory')
        .map((item: any) => item.path);

      // Create template data
      const templateData = {
        version: '1.0.0', // Template format version
        name: metadata.name,
        description: metadata.description,
        templateVersion: metadata.version,
        author: metadata.author,
        authorUrl: metadata.authorUrl,
        license: metadata.license,
        licenseLabel: metadata.licenseLabel,
        licenseDescription: metadata.licenseDescription,
        tags: metadata.tags || [],
        thumbnail: metadata.thumbnail,
        previewImages: metadata.previewImages || [],
        downloadUrl: metadata.downloadUrl,
        directories,
        files: files.map((file: any) => ({
          path: file.path,
          content: file.content
        })),
        assets: []
      };

      // Create ZIP archive
      const zip = new JSZip();
      zip.file('template.json', JSON.stringify(templateData, null, 2));

      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });

      logger.info('[TemplateService] Template exported successfully', {
        name: metadata.name,
        size: blob.size
      });

      return blob;
    } catch (error) {
      logger.error('[TemplateService] Failed to export template:', error);
      throw new Error(`Failed to export template: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Import a template file (.oswt)
   */
  async importTemplateFile(file: File): Promise<CustomTemplate> {
    try {
      logger.info('[TemplateService] Importing template file', { name: file.name, size: file.size });

      // Validate file
      if (!file.name.endsWith('.oswt')) {
        throw new Error('Invalid file type. Expected .oswt file.');
      }

      if (file.size > MAX_TEMPLATE_SIZE) {
        throw new Error(`File too large. Maximum size is ${Math.round(MAX_TEMPLATE_SIZE / 1024 / 1024)}MB.`);
      }

      // Read ZIP file
      const zip = new JSZip();
      const zipData = await zip.loadAsync(file);
      const templateFile = zipData.file('template.json');

      if (!templateFile) {
        throw new Error('Invalid template file format. Missing template.json.');
      }

      // Parse template data
      const templateJson = await templateFile.async('string');
      const templateData = JSON.parse(templateJson);

      // Validate template structure
      this.validateTemplateStructure(templateData);

      // Create CustomTemplate object
      const template: CustomTemplate = {
        id: uuidv4(),
        name: templateData.name,
        description: templateData.description,
        version: templateData.templateVersion || '1.0.0',
        files: templateData.files || [],
        directories: templateData.directories || [],
        assets: templateData.assets,
        metadata: {
          author: templateData.author,
          authorUrl: templateData.authorUrl,
          license: templateData.license || 'personal',
          licenseLabel: templateData.licenseLabel,
          licenseDescription: templateData.licenseDescription,
          tags: templateData.tags || [],
          thumbnail: templateData.thumbnail,
          previewImages: templateData.previewImages || [],
          downloadUrl: templateData.downloadUrl
        },
        importedAt: new Date()
      };

      // Save to IndexedDB
      await this.db.saveCustomTemplate(template);

      logger.info('[TemplateService] Template imported successfully', {
        id: template.id,
        name: template.name
      });

      return template;
    } catch (error) {
      logger.error('[TemplateService] Failed to import template:', error);
      throw new Error(`Failed to import template: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * List all custom templates
   */
  async listCustomTemplates(): Promise<CustomTemplate[]> {
    try {
      await this.init();
      const templates = await this.db.getAllCustomTemplates();
      return templates.sort((a, b) => b.importedAt.getTime() - a.importedAt.getTime());
    } catch (error) {
      logger.error('[TemplateService] Failed to list templates:', error);
      throw new Error('Failed to list templates');
    }
  }

  /**
   * Delete a custom template
   */
  async deleteCustomTemplate(id: string): Promise<void> {
    try {
      await this.init();
      await this.db.deleteCustomTemplate(id);
      logger.info('[TemplateService] Template deleted', { id });
    } catch (error) {
      logger.error('[TemplateService] Failed to delete template:', error);
      throw new Error('Failed to delete template');
    }
  }

  /**
   * Export a custom template back to .oswt file
   */
  async exportTemplateAsFile(template: CustomTemplate): Promise<Blob> {
    try {
      logger.info('[TemplateService] Re-exporting custom template', { id: template.id, name: template.name });

      const zip = new JSZip();

      // Add template.json
      zip.file('template.json', JSON.stringify(template, null, 2));

      // Add files
      for (const file of template.files) {
        if (file.content instanceof ArrayBuffer) {
          zip.file(file.path, file.content);
        } else {
          zip.file(file.path, file.content);
        }
      }

      return await zip.generateAsync({ type: 'blob' });
    } catch (error) {
      logger.error('[TemplateService] Failed to re-export template:', error);
      throw new Error(`Failed to export template: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate a thumbnail from a project preview (placeholder for now)
   */
  async generateThumbnail(projectId: string): Promise<string | undefined> {
    // TODO: Implement actual thumbnail generation from preview
    // For now, return undefined to indicate no thumbnail
    logger.info('[TemplateService] Thumbnail generation not yet implemented');
    return undefined;
  }

  /**
   * Validate template metadata
   */
  private validateMetadata(metadata: TemplateMetadata): void {
    if (!metadata.name || metadata.name.length < 1 || metadata.name.length > 50) {
      throw new Error('Template name must be between 1 and 50 characters');
    }

    if (!metadata.description || metadata.description.length < 10 || metadata.description.length > 500) {
      throw new Error('Template description must be between 10 and 500 characters');
    }

    if (!metadata.version || !/^\d+\.\d+\.\d+$/.test(metadata.version)) {
      throw new Error('Template version must be in semantic version format (e.g., 1.0.0)');
    }

    if (metadata.author && metadata.author.length > 50) {
      throw new Error('Author name must be 50 characters or less');
    }

    if (metadata.authorUrl && !this.isValidUrl(metadata.authorUrl)) {
      throw new Error('Author URL must be a valid URL');
    }

    if (!metadata.license) {
      throw new Error('License is required');
    }

    if (metadata.tags && metadata.tags.length > 10) {
      throw new Error('Maximum 10 tags allowed');
    }

    if (metadata.thumbnail && metadata.thumbnail.length > MAX_THUMBNAIL_SIZE) {
      throw new Error(`Thumbnail too large. Maximum size is ${Math.round(MAX_THUMBNAIL_SIZE / 1024)}KB`);
    }

    if (metadata.previewImages && metadata.previewImages.length > MAX_PREVIEW_IMAGES) {
      throw new Error(`Maximum ${MAX_PREVIEW_IMAGES} preview images allowed`);
    }

    if (metadata.previewImages) {
      for (const img of metadata.previewImages) {
        if (img.length > MAX_PREVIEW_IMAGE_SIZE) {
          throw new Error(`Preview image too large. Maximum size is ${Math.round(MAX_PREVIEW_IMAGE_SIZE / 1024)}KB per image`);
        }
      }
    }
  }

  /**
   * Validate template structure after import
   */
  private validateTemplateStructure(data: any): void {
    if (!data.name || typeof data.name !== 'string') {
      throw new Error('Invalid template: missing or invalid name');
    }

    if (!data.description || typeof data.description !== 'string') {
      throw new Error('Invalid template: missing or invalid description');
    }

    if (!data.files || !Array.isArray(data.files)) {
      throw new Error('Invalid template: missing or invalid files array');
    }

    if (!data.directories || !Array.isArray(data.directories)) {
      throw new Error('Invalid template: missing or invalid directories array');
    }

    // Validate required fields in files
    for (const file of data.files) {
      if (!file.path || typeof file.path !== 'string') {
        throw new Error('Invalid template: file missing path');
      }
      if (file.content === undefined) {
        throw new Error('Invalid template: file missing content');
      }
    }
  }

  /**
   * Validate URL format
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}

export const templateService = new TemplateService();

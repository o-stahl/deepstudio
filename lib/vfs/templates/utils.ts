import { ProjectTemplate } from '../project-templates';
import { saveManager } from '../save-manager';

export interface AssetConfig {
  /** Public filename (in /public/) */
  filename: string;
  /** Target path in VFS */
  path: string;
}

export async function createProjectFromTemplate(
  vfs: any,
  projectId: string,
  template: ProjectTemplate,
  assets?: AssetConfig[]
): Promise<void> {
  await saveManager.runWithSuppressedDirty(projectId, async () => {
    // Create directories
    for (const dir of template.directories) {
      await vfs.createDirectory(projectId, dir);
    }

    // Create template files
    for (const file of template.files) {
      let content: string | ArrayBuffer = file.content;

      if (file.isBase64) {
        const binaryString = atob(file.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        content = bytes.buffer;
      }

      await vfs.createFile(projectId, file.path, content);
    }

    // Fetch and add external assets if provided
    if (assets && assets.length > 0) {
      for (const asset of assets) {
        try {
          const response = await fetch(`${window.location.origin}/${asset.filename}`);
          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            await vfs.createFile(projectId, asset.path, arrayBuffer);
          }
          // Continue without this asset if it fails - template will still work
        } catch (error) {
          // Continue without this asset if it fails - template will still work
        }
      }
    }
  });
}
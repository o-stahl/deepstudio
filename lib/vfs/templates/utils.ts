import { ProjectTemplate } from '../project-templates';
import { saveManager } from '../save-manager';

export async function createProjectFromTemplate(
  vfs: any,
  projectId: string,
  template: ProjectTemplate
): Promise<void> {
  await saveManager.runWithSuppressedDirty(projectId, async () => {
    for (const dir of template.directories) {
      await vfs.createDirectory(projectId, dir);
    }

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
  });
}

export async function createDemoProjectWithAssets(
  vfs: any,
  projectId: string
): Promise<void> {
  // Import the demo template dynamically to avoid circular dependency
  const { DEMO_PROJECT_TEMPLATE } = await import('./demo');
  
  // First create the base template
  await createProjectFromTemplate(vfs, projectId, DEMO_PROJECT_TEMPLATE);
  
  try {
    // Fetch the background image from public directory
    const response = await fetch(`${window.location.origin}/example-background.jpg`);
    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      
      // Add the background image to the VFS
      await saveManager.runWithSuppressedDirty(projectId, async () => {
        await vfs.createFile(projectId, '/assets/images/example-background.jpg', arrayBuffer);
      });
    } else {
      // Continue without the background image - template will still work
    }
  } catch (error) {
    // Continue without the background image - template will still work
  }
}
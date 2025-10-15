import html2canvas from 'html2canvas';
import { logger } from '@/lib/utils';

/**
 * Captures a screenshot of an iframe's content at desktop resolution
 * @param iframe The iframe element to capture
 * @param captureWidth Capture width (default: 1280 - HD desktop)
 * @param captureHeight Capture height (default: 720 - HD desktop)
 * @param outputWidth Output width after scaling (default: 640)
 * @param outputHeight Output height after scaling (default: 360)
 * @param quality JPEG quality 0-1 (default: 0.8)
 * @returns Base64 data URL of the screenshot, or null if capture fails
 */
export async function captureIframeScreenshot(
  iframe: HTMLIFrameElement,
  captureWidth: number = 1280,
  captureHeight: number = 720,
  outputWidth: number = 640,
  outputHeight: number = 360,
  quality: number = 0.8
): Promise<string | null> {
  try {
    // Get the iframe's document
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;

    if (!iframeDoc || !iframeDoc.body) {
      logger.warn('Cannot access iframe document');
      return null;
    }

    // Capture the iframe content at desktop resolution using html2canvas with timeout
    const canvas = await Promise.race([
      html2canvas(iframeDoc.body, {
        width: captureWidth,
        height: captureHeight,
        scale: 1,
        useCORS: true,
        allowTaint: true,
        logging: false,
        windowWidth: captureWidth,
        windowHeight: captureHeight,
        scrollX: 0,
        scrollY: 0,
        // Add more options to prevent hanging
        imageTimeout: 3000,
        backgroundColor: null,
        removeContainer: true
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('html2canvas timeout after 4 seconds')), 4000)
      )
    ]);

    // Scale down the captured image for efficient storage
    const scaledCanvas = document.createElement('canvas');
    scaledCanvas.width = outputWidth;
    scaledCanvas.height = outputHeight;
    const ctx = scaledCanvas.getContext('2d');

    if (!ctx) {
      logger.error('Failed to get canvas context');
      return null;
    }

    // Draw the captured image scaled down
    ctx.drawImage(canvas, 0, 0, outputWidth, outputHeight);

    // Convert scaled canvas to base64 JPEG
    const dataUrl = scaledCanvas.toDataURL('image/jpeg', quality);

    // Validate size (max 250KB)
    const sizeInBytes = Math.ceil((dataUrl.length * 3) / 4);
    const sizeInKB = sizeInBytes / 1024;

    if (sizeInKB > 250) {
      logger.warn(`Screenshot too large: ${sizeInKB.toFixed(0)}KB, trying with lower quality`);
      // Retry with lower quality using scaled canvas
      const retryDataUrl = scaledCanvas.toDataURL('image/jpeg', 0.6);
      const retrySizeInKB = Math.ceil((retryDataUrl.length * 3) / 4) / 1024;

      if (retrySizeInKB > 250) {
        logger.warn(`Screenshot still too large: ${retrySizeInKB.toFixed(0)}KB`);
        return retryDataUrl; // Return anyway, let VFS handle size limit
      }

      return retryDataUrl;
    }

    return dataUrl;

  } catch (error) {
    logger.error('Failed to capture screenshot:', error);
    return null;
  }
}

/**
 * Image compression and type detection utilities for file upload.
 */

const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 0.85;

/**
 * Compress an image data URL by resizing and re-encoding as JPEG.
 * Max dimension is 1024px, JPEG quality 0.85 (matching goose desktop).
 */
export async function compressImageDataUrl(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new globalThis.Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
      const width = Math.floor(img.width * scale);
      const height = Math.floor(img.height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);

      resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

/**
 * Check if a File object is an image based on its MIME type.
 */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/**
 * Extract base64 data and MIME type from a data URL.
 * Returns null if the data URL is malformed.
 */
export function parseDataUrl(dataUrl: string): { data: string; mimeType: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

/**
 * Read a File as a data URL string.
 */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

import type { ImageQualityReport, ImageQueueItem } from './types.ts';

/**
 * Measure image dimensions and calculate quality heuristics (brightness, contrast, resolution).
 */
export async function measureImage(
  file: File
): Promise<{ width: number; height: number; megapixels: number; quality: ImageQualityReport }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      const megapixels = Math.round(((width * height) / 1000000) * 100) / 100;

      // Sample image to measure luminosity and contrast
      const sampleWidth = Math.min(width, 300);
      const sampleHeight = Math.min(height, 300);
      const canvas = document.createElement('canvas');
      canvas.width = sampleWidth;
      canvas.height = sampleHeight;
      const ctx = canvas.getContext('2d');

      const reasons: Array<{ code?: string; message: string }> = [];
      let brightness = 128;
      let contrast = 50;

      if (ctx) {
        ctx.drawImage(img, 0, 0, sampleWidth, sampleHeight);
        try {
          const imageData = ctx.getImageData(0, 0, sampleWidth, sampleHeight);
          const data = imageData.data;
          let sumLuminance = 0;
          const pixelCount = data.length / 4;

          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            // Standard perceptual luminance
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            sumLuminance += lum;
          }

          brightness = sumLuminance / pixelCount;

          let sumVariance = 0;
          for (let i = 0; i < data.length; i += 4) {
            const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            sumVariance += (lum - brightness) ** 2;
          }
          contrast = Math.sqrt(sumVariance / pixelCount);
        } catch {
          // Canvas read error fallback
        }
      }

      let score = 1.0;

      // Resolution checks
      if (width < 600 || height < 400) {
        score -= 0.3;
        reasons.push({
          code: 'LOW_RES',
          message: `Low resolution (${width}×${height}px). Minimum 800×600 recommended for OCR fidelity.`,
        });
      }

      // Brightness checks
      if (brightness < 45) {
        score -= 0.35;
        reasons.push({
          code: 'UNDEREXPOSED',
          message: 'Severe underexposure detected; declarations in shadow may be illegible.',
        });
      } else if (brightness > 220) {
        score -= 0.3;
        reasons.push({
          code: 'OVEREXPOSED',
          message: 'Overexposure or specular glare detected on package surface.',
        });
      }

      // Contrast checks
      if (contrast < 22) {
        score -= 0.25;
        reasons.push({
          code: 'LOW_CONTRAST',
          message: 'Low contrast detected; text boundaries may be washed out.',
        });
      }

      score = Math.max(0.1, Math.min(1.0, score));

      let status: 'GOOD' | 'WARN' | 'POOR' = 'GOOD';
      if (score < 0.6) {
        status = 'POOR';
      } else if (score < 0.85) {
        status = 'WARN';
      }

      resolve({
        width,
        height,
        megapixels,
        quality: {
          status,
          score: Math.round(score * 100) / 100,
          brightness: Math.round(brightness),
          contrast: Math.round(contrast),
          width,
          height,
          reasons,
        },
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for quality inspection.'));
    };

    img.src = url;
  });
}

/**
 * Scale and compress an image file to JPEG Blob for upload efficiency.
 */
export async function compressImage(
  file: File,
  maxWidth = 1200,
  maxHeight = 1200,
  quality = 0.8
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;

      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        resolve(file);
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else resolve(file);
        },
        'image/jpeg',
        quality
      );
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };

    img.src = url;
  });
}

/**
 * Convert Blob to raw base64 string without data: URL prefix.
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Aggregate individual image quality reports into an overall batch assessment.
 */
export function aggregateQuality(files: ImageQueueItem[]): ImageQualityReport {
  if (!files.length) {
    return {
      status: 'WARN',
      score: 0.5,
      reasons: [{ message: 'No evidence uploaded yet.' }],
    };
  }

  let totalScore = 0;
  const reasons: Array<{ code?: string; message: string }> = [];
  let hasPoor = false;
  let hasWarn = false;

  for (const item of files) {
    totalScore += item.quality.score;
    if (item.quality.status === 'POOR') hasPoor = true;
    if (item.quality.status === 'WARN') hasWarn = true;
    for (const r of item.quality.reasons) {
      if (!reasons.some((existing) => existing.message === r.message)) {
        reasons.push(r);
      }
    }
  }

  const avgScore = totalScore / files.length;
  const status: 'GOOD' | 'WARN' | 'POOR' =
    hasPoor || avgScore < 0.6 ? 'POOR' : hasWarn || avgScore < 0.8 ? 'WARN' : 'GOOD';

  return {
    status,
    score: Math.round(avgScore * 100) / 100,
    reasons,
  };
}

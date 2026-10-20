export interface VisualCapture {
  canvas: HTMLCanvasElement;
  draw(): void;
  dispose(): void;
}

export function captureSurface(width: number, height: number, fps = 30) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 8294400)
    throw new Error('Choose video dimensions up to 4096 pixels and 8.3 million pixels per frame.');
  if (!Number.isFinite(fps) || fps < 1 || fps > 60) throw new Error('Choose a video frame rate from 1 to 60 FPS.');
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot create a video canvas.');
  function paint(source: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement): void {
    const sourceWidth = source instanceof HTMLVideoElement ? source.videoWidth : source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const sourceHeight = source instanceof HTMLVideoElement ? source.videoHeight : source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    if (!sourceWidth || !sourceHeight) throw new Error('Wait for this scene to load before recording.');
    const scale = Math.min(width / sourceWidth, height / sourceHeight), w = sourceWidth * scale, h = sourceHeight * scale;
    context!.fillStyle = '#081714'; context!.fillRect(0, 0, width, height);
    context!.drawImage(source, (width - w) / 2, (height - h) / 2, w, h);
    // Detect origin restrictions before a recorder can silently produce black frames.
    context!.getImageData(0, 0, 1, 1);
  }
  return { canvas, context, paint };
}

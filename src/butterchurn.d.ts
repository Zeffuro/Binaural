declare module 'butterchurn' {
  interface Visualizer {
    loadPreset(preset: Record<string, unknown>, blendTime: number): void;
    setRendererSize(width: number, height: number): void;
    render(options: { elapsedTime: number; audioLevels: { timeByteArray: Uint8Array; timeByteArrayL: Uint8Array; timeByteArrayR: Uint8Array } }): void;
  }
  const butterchurn: { createVisualizer(context: BaseAudioContext | null, canvas: HTMLCanvasElement,
    options: { width: number; height: number; pixelRatio: number; meshWidth: number; meshHeight: number }): Visualizer };
  export default butterchurn;
}

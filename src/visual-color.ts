export interface LightColor { hue: number; saturation: number; level: number }

export function fromHex(hex: string, previousHue: number): LightColor {
  const channels = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [red, green, blue] = channels;
  const high = Math.max(...channels);
  const low = Math.min(...channels);
  const delta = high - low;
  const level = (high + low) / 2;
  let hue = previousHue;
  if (delta) {
    const sector = high === red ? (green - blue) / delta : high === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
    hue = ((sector * 60) + 360) % 360;
  }
  return { hue, saturation: delta ? Math.min(100, delta / (1 - Math.abs(2 * level - 1)) * 100) : 0, level: level * 100 };
}

export function toHex({ hue, saturation, level }: LightColor): string {
  const lightness = level / 100;
  const amplitude = saturation / 100 * Math.min(lightness, 1 - lightness);
  const channel = (offset: number) => {
    const position = (offset + hue / 30) % 12;
    const value = lightness - amplitude * Math.max(-1, Math.min(position - 3, 9 - position, 1));
    return Math.round(value * 255).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

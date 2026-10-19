import type { LightColor } from './visual-color';
import { butterchurnPresets } from './butterchurn-presets';
import { moodscapes } from './moodscape-catalog';
import { defaultTriggerSettings, parseTriggerSettings, type TriggerSettings } from './trigger-state';
import type { VisualQuality } from './adaptive-visual-quality';

export type { VisualQuality } from './adaptive-visual-quality';
export interface VisualSettings {
  light: { enabled: boolean; color: LightColor; mode: 'still' | 'breathe' | 'cycle'; speed: number; studio: boolean };
  scene: string;
  milkdropPreset: string;
  natureDirection: number;
  quality: VisualQuality;
  autoCycle: boolean;
  cycleSeconds: number;
  blendSeconds: number;
  triggers: TriggerSettings;
}

export const sceneModes = ['off', 'spectrum', 'scope', 'orbits', 'aurora', 'water', 'local', 'milkdrop', 'triggers', ...moodscapes.map(item => `nature:${item.id}`)];

export function defaultVisualSettings(): VisualSettings {
  return { light: { enabled: false, color: { hue: 140, saturation: 40, level: 35 }, mode: 'still', speed: 30, studio: false },
    scene: 'off', milkdropPreset: butterchurnPresets[0].id, natureDirection: 0, quality: 'balanced', autoCycle: false, cycleSeconds: 30, blendSeconds: 2, triggers: defaultTriggerSettings() };
}

export function parseVisualSettings(value: unknown): VisualSettings {
  const object = (item: unknown): Record<string, unknown> => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid visual settings.');
    return item as Record<string, unknown>;
  };
  const number = (item: unknown, min: number, max: number): number => {
    if (typeof item !== 'number' || !Number.isFinite(item) || item < min || item > max) throw new Error('Visual value is outside its supported range.');
    return item;
  };
  const boolean = (item: unknown): boolean => { if (typeof item !== 'boolean') throw new Error('Invalid visual switch.'); return item; };
  const choice = <T extends string>(item: unknown, choices: readonly T[]): T => {
    if (typeof item !== 'string' || !choices.includes(item as T)) throw new Error('Unknown visual option.');
    return item as T;
  };
  const state = object(value), light = object(state.light), color = object(light.color);
  return { light: { enabled: boolean(light.enabled), color: { hue: number(color.hue, 0, 360), saturation: number(color.saturation, 0, 100), level: number(color.level, 0, 100) },
    mode: choice(light.mode, ['still', 'breathe', 'cycle']), speed: number(light.speed, 10, 120), studio: boolean(light.studio) },
    scene: choice(state.scene, sceneModes), milkdropPreset: choice(state.milkdropPreset, butterchurnPresets.map(item => item.id)),
    natureDirection: number(state.natureDirection, 0, 360), quality: choice(state.quality, ['eco', 'balanced', 'high', 'auto']),
    autoCycle: boolean(state.autoCycle), cycleSeconds: number(state.cycleSeconds, 10, 300), blendSeconds: number(state.blendSeconds, 0, 10),
    triggers: state.triggers === undefined ? defaultTriggerSettings() : parseTriggerSettings(state.triggers) };
}

export function visualBudget(quality: VisualQuality): { fps: number; ratio: number; maxWidth: number } {
  return quality === 'eco' || quality === 'auto' ? { fps: 30, ratio: 1, maxWidth: 960 } : quality === 'high' ? { fps: 60, ratio: 2, maxWidth: 1920 } : { fps: 45, ratio: 1.5, maxWidth: 1280 };
}

export function visualRatio(width: number, quality: VisualQuality): number {
  const budget = visualBudget(quality);
  return Math.min(devicePixelRatio || 1, budget.ratio, budget.maxWidth / Math.max(width, 1));
}

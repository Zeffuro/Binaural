import { bwgDuration, decodeBwg, type BwgProgram } from './import/bwg-program';
import { validateCurves } from './audio/bwg-curves';
import { generatedBackgrounds, type GeneratedBackgroundId } from './audio/generated-backgrounds';
import { backgroundSources, type BackgroundSource } from './import/bwg-background';
import { parseVisualSettings, type VisualSettings } from './visual-state';
import { parseAsmr, type AsmrSettings } from './asmr-state';
import { listeningModes, type ListeningMode } from './listening-mode';
import { outputDynamicsProfiles, type OutputDynamicsProfile } from './output-dynamics';

export type Route = 'binaural' | 'mixed' | 'left' | 'right';
export type Ambient = 'none' | 'white' | 'pink' | 'brown' | 'ocean' | GeneratedBackgroundId;
export interface AutomationPoint { time: number; value: number; curve: 'linear' | 'step' }
export interface LayerAutomation {
  left: AutomationPoint[];
  right: AutomationPoint[];
  leftLevel: AutomationPoint[];
  rightLevel: AutomationPoint[];
}
export interface Layer {
  id: string;
  name: string;
  left: number;
  right: number;
  level: number;
  route: Route;
  automation?: LayerAutomation;
}
export interface Session {
  version: 1 | 2;
  name: string;
  layers: Layer[];
  ambient: Ambient;
  ambientLevel: number;
  musicLevel: number;
  master: number;
  volumeBoost?: boolean;
  dynamics?: OutputDynamicsProfile;
  minutes: number;
  tonesMuted?: boolean;
  visual?: VisualSettings;
  asmr?: AsmrSettings;
  mode?: ListeningMode;
  timelineDuration?: number;
  bwg?: BwgProgram;
  bwgBackgroundSource?: BackgroundSource;
  bwgMuted?: boolean;
  source?: { format: 'bwg'; name: string; description?: string; author?: string };
}

export const MAX_LAYERS = 10;
export const routes: Route[] = ['binaural', 'mixed', 'left', 'right'];
export const ambients: Ambient[] = ['none', 'white', 'pink', 'brown', 'ocean', ...generatedBackgrounds.map(item => item.id)];
export const makeLayer = (left = 200, right = 210, name = 'Custom tone'): Layer => ({
  id: crypto.randomUUID(), name, left, right, level: 0.6, route: 'binaural',
});
export const initialSession = (): Session => ({
  version: 1, name: 'Quiet morning', layers: [makeLayer(200, 210, 'Alpha 10 Hz')],
  ambient: 'pink', ambientLevel: 0.2, musicLevel: 0.4, master: 0.2, minutes: 20,
});

const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const number = (x: unknown, min: number, max: number): x is number =>
  typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;
const name = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= 80;

function parseAutomation(value: unknown, duration: number): LayerAutomation {
  if (!record(value)) throw new Error('Invalid automation.');
  const result = {} as LayerAutomation;
  for (const field of ['left', 'right', 'leftLevel', 'rightLevel'] as const) {
    const points = value[field];
    if (!Array.isArray(points) || points.length < 1 || points.length > 12000) throw new Error('Invalid automation point count.');
    let last = -1;
    result[field] = points.map(point => {
      if (!record(point) || !number(point.time, 0, duration) || point.time < last ||
          !number(point.value, field.endsWith('Level') ? 0 : 20, field.endsWith('Level') ? 1 : 2000) ||
          (point.curve !== 'linear' && point.curve !== 'step')) throw new Error('Invalid automation point.');
      last = point.time;
      return { time: point.time, value: point.value, curve: point.curve as AutomationPoint['curve'] };
    });
    if (result[field][0].time !== 0) throw new Error('Automation must start at zero.');
  }
  return result;
}

export function parseSession(value: unknown): Session {
  const native = record(value) && value.bwg !== undefined ? decodeBwg(value.bwg) : undefined;
  if (native) validateCurves(native.preset);
  if (record(value) && value.bwgBackgroundSource !== undefined &&
      !backgroundSources.includes(value.bwgBackgroundSource as BackgroundSource)) throw new Error('Invalid background source preference.');
  if (!record(value) || (value.version !== 1 && value.version !== 2) || !name(value.name) ||
      !Array.isArray(value.layers) || value.layers.length < 1 || value.layers.length > MAX_LAYERS ||
      !ambients.includes(value.ambient as Ambient) || !number(value.ambientLevel, 0, 1) ||
      !number(value.musicLevel, 0, 1) || !number(value.master, 0, value.volumeBoost === true ? 2 : 1) || !number(value.minutes, 0, native ? 360000000 : 180)) {
    throw new Error('Invalid preset. Use a Binaural JSON file with 1–10 layers.');
  }
  if (value.tonesMuted !== undefined && typeof value.tonesMuted !== 'boolean') throw new Error('Invalid tone mute state.');
  if (value.volumeBoost !== undefined && typeof value.volumeBoost !== 'boolean') throw new Error('Invalid volume boost state.');
  if (value.mode !== undefined && !listeningModes.includes(value.mode as ListeningMode)) throw new Error('Invalid listening mode.');
  if (value.dynamics !== undefined && !outputDynamicsProfiles.some(profile => profile.id === value.dynamics)) throw new Error('Invalid output dynamics profile.');
  if (value.bwgMuted !== undefined && typeof value.bwgMuted !== 'boolean') throw new Error('Invalid imported audio mute state.');
  const duration = value.timelineDuration;
  if (native ? duration !== bwgDuration(native.preset) : duration !== undefined && !number(duration, 0.01, 10800)) {
    throw new Error('Invalid timeline duration.');
  }
  const layers = value.layers.map((layer): Layer => {
    if (!record(layer) || !name(layer.name) || !number(layer.left, native ? 0 : 20, native ? 20500 : 2000) ||
        !number(layer.right, native ? 0 : 20, native ? 20500 : 2000) || !number(layer.level, 0, 1) || !routes.includes(layer.route as Route)) {
      throw new Error('Invalid tone layer. Frequencies must be 20–2000 Hz and levels 0–1.');
    }
    return { id: crypto.randomUUID(), name: layer.name.trim(), left: layer.left, right: layer.right,
      level: layer.level, route: layer.route as Route,
      ...(layer.automation === undefined ? {} : { automation: parseAutomation(layer.automation, duration as number) }) };
  });
  if (layers.some(layer => layer.automation) && duration === undefined) throw new Error('Automation needs a timeline duration.');
  if (native && (layers.length !== Math.max(...native.preset.segments.map(segment => segment.voices)) ||
      layers.some(layer => layer.automation))) throw new Error('Invalid BWGen voice layout.');
  let source: Session['source'];
  if (value.source !== undefined) {
    const input = value.source;
    if (!record(input) || input.format !== 'bwg' || !name(input.name) ||
        (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 65536)) ||
        (input.author !== undefined && !name(input.author))) throw new Error('Invalid preset provenance.');
    source = { format: 'bwg', name: input.name, description: input.description as string | undefined, author: input.author as string | undefined };
  }
  return { version: value.version, name: value.name.trim(), layers, ambient: value.ambient as Ambient,
    ambientLevel: value.ambientLevel, musicLevel: value.musicLevel, master: value.master, minutes: value.minutes,
    ...(duration === undefined ? {} : { timelineDuration: duration as number }), ...(source ? { source } : {}),
    ...(native ? { bwg: native.program } : {}),
    ...(value.bwgBackgroundSource === undefined ? {} : { bwgBackgroundSource: value.bwgBackgroundSource as BackgroundSource }),
    ...(value.tonesMuted === undefined ? {} : { tonesMuted: value.tonesMuted }),
    ...(value.volumeBoost === undefined ? {} : { volumeBoost: value.volumeBoost }),
    ...(value.dynamics === undefined ? {} : { dynamics: value.dynamics as OutputDynamicsProfile }),
    ...(value.bwgMuted === undefined ? {} : { bwgMuted: value.bwgMuted }),
    ...(value.mode === undefined ? {} : { mode: value.mode as ListeningMode }),
    ...(value.visual === undefined ? {} : { visual: parseVisualSettings(value.visual) }),
    ...(value.asmr === undefined ? {} : { asmr: parseAsmr(value.asmr) }) };
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

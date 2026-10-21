import type { Preset } from './catalog';
import { initialSession } from './model';
import { asmrPresets } from './asmr-presets';
import { asmrSounds } from './asmr-state';
import { defaultVisualSettings, parseVisualSettings } from './visual-state';
import { triggerPresets } from './trigger-presets';

export function asmrPresetLight(id: string): string | undefined {
  return asmrPresets.find(preset => `asmr-${preset.id}` === id)?.light;
}

export function asmrExplorerPresets(): Preset[] {
  return asmrPresets.map(preset => {
    const asmr = preset.make();
    const light = triggerPresets.find(light => light.id === preset.light);
    const visual = light ? parseVisualSettings({ ...defaultVisualSettings(), scene: 'triggers', triggers: {
      ...light.settings, brightness: .3, speed: Math.min(.015, light.settings.speed), drift: Math.min(.06, light.settings.drift),
      lightSpeed: Math.min(.05, light.settings.lightSpeed), reaction: Math.min(.2, light.settings.reaction), preset: 'custom',
    } }) : undefined;
    return { id: `asmr-${preset.id}`, name: preset.name, category: 'ASMR', description: preset.description,
      tags: ['asmr', preset.group ?? 'Layered mixes', ...asmr.layers.flatMap(layer => {
        const sound = asmrSounds.find(sound => sound.id === layer.sound)!;
        return [sound.name, sound.description];
      })],
      aliases: [], sources: [], evidence: 'Original sound arrangement using built-in textures and CC0 recordings. Sound credits are available in the ASMR mixer.',
      visualLabel: light?.name,
      session: { ...initialSession(), version: 2, name: preset.name, mode: 'asmr', ambient: 'none', asmr, ...(visual ? { visual } : {}),
        minutes: preset.minutes ?? 20 } };
  });
}

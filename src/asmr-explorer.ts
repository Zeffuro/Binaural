import type { Preset } from './catalog';
import { initialSession } from './model';
import { asmrPresets } from './asmr-presets';
import { asmrSounds } from './asmr-state';

export function asmrExplorerPresets(): Preset[] {
  return asmrPresets.map(preset => {
    const asmr = preset.make();
    return { id: `asmr-${preset.id}`, name: preset.name, category: 'ASMR', description: preset.description,
      tags: ['asmr', 'group' in preset ? preset.group : 'Layered mixes', ...asmr.layers.map(layer => asmrSounds.find(sound => sound.id === layer.sound)!.name)],
      aliases: [], sources: [], evidence: 'Original sound arrangement using built-in textures and CC0 recordings. Sound credits are available in the ASMR mixer.',
      session: { ...initialSession(), version: 2, name: preset.name, mode: 'asmr', ambient: 'none', asmr } };
  });
}

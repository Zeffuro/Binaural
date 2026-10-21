import { frequencies, presets, type Preset } from './catalog';
import { escapeHtml as e } from './model';
import { favoriteFrequencies, frequencyKey } from './frequency-favorites';
import { asmrExplorerPresets } from './asmr-explorer';
import { asmrSounds } from './asmr-state';

const links = (urls: string[]) => urls.map((url, i) => `<a href="${e(url)}" target="_blank" rel="noreferrer">Usage source ${i + 1} ↗</a>`).join(' ');

export function frequencyDetail(index: number): string {
  const f = frequencies[index];
  return `<h3>${e(f.label)}: ${f.hz} Hz ${f.kind === 'beat' ? 'difference' : 'carrier'}</h3>
    <p>${e(f.detail)}</p><p>${e(f.evidence)}</p>
    <p class="small-muted">Also called: ${e(f.aliases.join(', ') || f.label)}</p><p>${links(f.sources)}</p><button class="secondary-button" data-favorite-frequency="${index}" aria-pressed="${favoriteFrequencies().has(frequencyKey(f))}">Favorite ${e(f.label)}</button>`;
}

export function setupExplorer(load: (preset: Preset, play?: boolean) => Promise<void>): void {
  const dialog = document.querySelector<HTMLDialogElement>('#preset-explorer')!;
  const search = document.querySelector<HTMLInputElement>('#preset-search')!;
  const category = document.querySelector<HTMLSelectElement>('#preset-category')!;
  const withVisuals = document.querySelector<HTMLInputElement>('#preset-with-visuals')!;
  const experiences = [...presets, ...asmrExplorerPresets()];
  category.innerHTML += [...new Set(experiences.map(p => p.category))].map(value => `<option>${e(value)}</option>`).join('');
  function render(): void {
    const terms = search.value.trim().toLowerCase().split(/\s+/);
    const visible = experiences.filter(p => (!withVisuals.checked || p.session.visual) && (category.value === 'all' || p.category === category.value) &&
      terms.every(term => [p.name, p.description, ...p.tags, ...p.aliases,
        ...(p.session.asmr ? [] : p.session.layers.flatMap(l => [l.left, l.right, Math.abs(l.right - l.left)]))].join(' ').toLowerCase().includes(term)));
    document.querySelector('#preset-count')!.textContent = `${visible.length} of ${experiences.length} presets`;
    document.querySelector('#preset-results')!.innerHTML = visible.length ? visible.map(p => `
      <article class="explore-card"><div class="section-heading"><span class="eyebrow">${e(p.category)}</span><span class="small-muted">${p.session.minutes} min, ${p.session.asmr ? `${p.session.asmr.layers.length} sound${p.session.asmr.layers.length === 1 ? '' : 's'}` : `${p.session.layers.length} tone layer${p.session.layers.length === 1 ? '' : 's'}`}</span></div>
        <h3>${e(p.name)}</h3><p>${e(p.description)}</p><div class="recipe-tones">${p.session.asmr ? [...new Set(p.session.asmr.layers.map(l => asmrSounds.find(sound => sound.id === l.sound)!.name))].map(name => `<span>${e(name)}</span>`).join('') : p.session.layers.map(l => `<span>${l.left} / ${l.right} Hz <b>Δ ${Number(Math.abs(l.right - l.left).toFixed(3))} Hz</b></span>`).join('')}</div>
        ${p.visualLabel ? `<p class="experience-label">Visual: ${e(p.visualLabel)}${p.session.tonesMuted ? '. Tone layers muted.' : ''}</p>` : ''}
        <details><summary>Recipe notes & sources</summary><p>${e(p.evidence)}</p>${p.sources.length ? `<p>${links(p.sources)}</p><p class="small-muted">Names describe traditions or intentions. Linked sources provide context for these recipes.</p>` : ''}</details>
        <div class="preset-actions"><button class="save-button" data-load-preset="${e(p.id)}">Load ${e(p.name)} ↗</button><button class="secondary-button" data-play-preset="${e(p.id)}" aria-label="Load and play ${e(p.name)}">Load and play</button></div>
      </article>`).join('') : '<p>No presets match. Try a broader search or another category.</p>';
  }
  document.querySelector('#explore-presets')!.addEventListener('click', () => { render(); dialog.showModal(); });
  document.querySelector('#close-explorer')!.addEventListener('click', () => dialog.close());
  search.addEventListener('input', render);
  category.addEventListener('change', render);
  withVisuals.addEventListener('change', render);
  document.querySelector('#preset-results')!.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-load-preset], [data-play-preset]');
    const preset = experiences.find(p => p.id === (button?.dataset.loadPreset ?? button?.dataset.playPreset));
    if (!preset || !button) return;
    button.disabled = true;
    void load(preset, !!button.dataset.playPreset).then(() => dialog.close()).catch(error => { document.querySelector('#notice')!.textContent = error instanceof Error ? error.message : 'Preset could not load.'; document.querySelector<HTMLElement>('#notice')!.hidden = false; }).finally(() => { button.disabled = false; });
  });
}

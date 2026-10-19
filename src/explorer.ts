import { frequencies, presets, type Preset } from './catalog';
import { escapeHtml as e } from './model';

const links = (urls: string[]) => urls.map((url, i) => `<a href="${e(url)}" target="_blank" rel="noreferrer">Usage source ${i + 1} ↗</a>`).join(' ');

export function frequencyDetail(index: number): string {
  const f = frequencies[index];
  return `<h3>${e(f.label)}: ${f.hz} Hz ${f.kind === 'beat' ? 'difference' : 'carrier'}</h3>
    <p>${e(f.detail)}</p><p>${e(f.evidence)}</p>
    <p class="small-muted">Also called: ${e(f.aliases.join(', ') || f.label)}</p><p>${links(f.sources)}</p>`;
}

export function setupExplorer(load: (preset: Preset) => Promise<void>): void {
  const dialog = document.querySelector<HTMLDialogElement>('#preset-explorer')!;
  const search = document.querySelector<HTMLInputElement>('#preset-search')!;
  const category = document.querySelector<HTMLSelectElement>('#preset-category')!;
  category.innerHTML += [...new Set(presets.map(p => p.category))].map(value => `<option>${e(value)}</option>`).join('');
  function render(): void {
    const terms = search.value.trim().toLowerCase().split(/\s+/);
    const visible = presets.filter(p => (category.value === 'all' || p.category === category.value) &&
      terms.every(term => [p.name, p.description, ...p.tags, ...p.aliases,
        ...p.session.layers.flatMap(l => [l.left, l.right, Math.abs(l.right - l.left)])].join(' ').toLowerCase().includes(term)));
    document.querySelector('#preset-count')!.textContent = `${visible.length} of ${presets.length} original presets`;
    document.querySelector('#preset-results')!.innerHTML = visible.length ? visible.map(p => `
      <article class="explore-card"><div class="section-heading"><span class="eyebrow">${e(p.category)}</span><span class="small-muted">${p.session.minutes} min, ${p.session.layers.length} layer${p.session.layers.length === 1 ? '' : 's'}</span></div>
        <h3>${e(p.name)}</h3><p>${e(p.description)}</p><div class="recipe-tones">${p.session.layers.map(l => `<span>${l.left} / ${l.right} Hz <b>Δ ${Number(Math.abs(l.right - l.left).toFixed(3))} Hz</b></span>`).join('')}</div>
        <details><summary>Recipe notes & sources</summary><p>${e(p.evidence)}</p><p>${links(p.sources)}</p><p class="small-muted">Names document traditions or intentions. This original recipe is not a copy of the linked source's preset.</p></details>
        <button class="save-button" data-load-preset="${e(p.id)}">Load ${e(p.name)} ↗</button>
      </article>`).join('') : '<p>No presets match. Try a broader search or another category.</p>';
  }
  document.querySelector('#explore-presets')!.addEventListener('click', () => { render(); dialog.showModal(); });
  document.querySelector('#close-explorer')!.addEventListener('click', () => dialog.close());
  search.addEventListener('input', render);
  category.addEventListener('change', render);
  document.querySelector('#preset-results')!.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-load-preset]');
    const preset = presets.find(p => p.id === button?.dataset.loadPreset);
    if (!preset || !button) return;
    button.disabled = true;
    void load(preset).then(() => dialog.close()).finally(() => { button.disabled = false; });
  });
}

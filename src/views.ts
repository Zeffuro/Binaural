import { escapeHtml as e, type Layer, type Session } from './model';
import { frequencies, presets } from './catalog';
import { generatedBackgrounds } from './audio/generated-backgrounds';
import { frequencyKey } from './frequency-favorites';

export const layout = `
  <nav class="skip-links" aria-label="Skip to section"><a href="#transport">Skip to playback</a><a href="#tone-controls">Skip to tones</a><a href="#atmosphere">Skip to atmosphere</a><a href="#visual-controls">Skip to visuals</a></nav>
  <aside class="sidebar">
    <a class="brand" href="./" aria-label="Binaural home"><span class="brand-mark">◖◗</span> binaural<span class="brand-dot">.</span></a>
    <p class="eyebrow sidebar-label">YOUR LISTENING SPACE</p>
    <div class="nav-current"><span>◉</span> Sound studio <span class="tiny">01</span></div>
    <button id="explore-presets" class="sidebar-import">◎ Explore all presets</button>
    <div class="sidebar-heading"><h2>Start somewhere</h2><span>↘</span></div>
    <div id="builtins" class="preset-list"></div>
    <div class="sidebar-heading"><h2>Your presets</h2><span id="saved-count">0</span></div>
    <select id="saved-filter" aria-label="Filter saved presets"><option value="all">All saved presets</option><option value="favorites">Favorites</option><option value="recent">Recently played</option></select><div id="saved" class="preset-list"></div>
    <button id="import-button" class="sidebar-import">＋ Import a preset</button>
    <a class="bwg-library-link" href="https://www.bwgen.com/presets.html" target="_blank" rel="noopener noreferrer">Browse BWGen's library ↗</a>
    <input id="import-file" type="file" accept=".json,.bwg,application/json" hidden />
    <div class="sidebar-footer"><span class="local-dot"></span> Yours, locally.<p>No account. No uploads.<br>Just a little room to listen.</p><span class="version">BINAURAL / V0.1 / GPLv3</span></div>
  </aside>
  <main>
    <header class="topbar"><span>SOUND STUDIO <span class="slash">/</span> <span id="session-label">Quiet morning</span></span><span class="local-badge">◌ LOCAL SESSION</span></header>
    <div class="workspace">
      <section class="intro"><p class="eyebrow">TUNE IN. SLOW DOWN.</p><h1>Find your own<br><em>frequency.</em></h1><p>A few tones. A little atmosphere.<br>A space that sounds like you.</p>
        <div class="orb-scene" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="orb"></div><div class="orb-dot"></div><span class="orb-caption">A LITTLE SPACE TO LISTEN</span></div>
      </section>
      <div class="studio-grid">
        <div class="mixer-column">
          <section id="transport" class="transport panel" aria-label="Playback" tabindex="-1">
            <div class="transport-top"><div><span class="eyebrow">CURRENT SESSION</span><h2 id="playing-title">Quiet morning</h2></div><span id="status" class="status">Ready when you are</span></div>
            <div class="transport-controls"><button id="play" class="play-button"><span aria-hidden="true">▶</span><span>Start listening</span></button><button id="pause" class="secondary-button" hidden>Ⅱ Pause</button><span id="clock" class="clock">20:00</span><span class="timer-caption">session time</span></div>
            <div class="master-row"><label for="master">Master volume</label><input id="master" type="range" min="0" max="1" step="0.01" value="0.2" /><output id="master-value" for="master">20%</output></div>
            <p class="listening-note">♧ Stereo headphones for binaural beats. Start with low device volume.</p>
            <div id="visual-quick"></div>
          </section>
          <section id="asmr-controls" class="panel" tabindex="-1" aria-label="ASMR mixer"></section>
          <section id="tone-controls" class="panel tone-panel" tabindex="-1"><div class="section-heading"><div><span class="eyebrow">THE FOUNDATION</span><h2>Tone layers <span id="layer-count" class="count"></span></h2></div><button id="add-layer" class="text-button">＋ Add layer</button></div><div id="timeline-info" class="detail-box" hidden><p id="timeline-label"></p><button id="make-static" class="secondary-button">Make an editable static copy</button></div><div id="layers"></div></section>
          <section class="panel frequency-panel"><div class="section-heading"><div><span class="eyebrow">A PLACE TO EXPLORE</span><h2>Frequency collection</h2></div><span class="small-muted">Select to add a layer ↗</span></div><label class="search-label" for="frequency-search">Find a frequency, name or tradition</label><input id="frequency-search" type="search" placeholder="Try theta, 528, Schumann…" /><div class="frequency-filter"><label for="frequency-filter">Show frequencies</label><select id="frequency-filter"><option value="all">All frequencies</option><option value="favorites">Favorites</option></select></div><p id="frequency-count" class="small-muted"></p><div id="frequencies"></div><div id="frequency-detail" class="detail-box" hidden></div>
            <details class="evidence"><summary>What do these names mean?</summary><p>Brainwave bands describe EEG rhythms; choosing their frequency does not guarantee a mental state. Solfeggio names such as “Love” and “Consciousness” are traditional wellness labels with unproven effects. A carrier is an audible tone; a beat is the difference between two tones.</p><p>Research on consistent brainwave entrainment is mixed. This is a creative listening tool, not a treatment. <a href="https://doi.org/10.1371/journal.pone.0286023" target="_blank" rel="noreferrer">Read the systematic review ↗</a></p></details>
          </section>
        </div>
        <div class="inspector-column">
          <section id="atmosphere" class="panel atmosphere-panel" tabindex="-1"><span class="eyebrow">SET THE SCENE</span><h2>A little atmosphere</h2><p class="small-muted">A soft bed beneath your tones.</p><label for="ambient">Background sound</label><select id="ambient"><option value="none">Just the tones</option><option value="pink">Pink noise (soft & balanced)</option><option value="brown">Brown noise (warm & low)</option><option value="white">White noise (bright & even)</option><option value="ocean">Slow sea</option>${[...new Set(generatedBackgrounds.map(item => item.group))].map(group => `<optgroup label="${e(group)}">${generatedBackgrounds.filter(item => item.group === group).map(item => `<option value="${item.id}">${e(item.name)}</option>`).join('')}</optgroup>`).join('')}</select><p class="fine-print">Built-in sounds are synthesized.</p><label class="range-heading" for="ambient-level">Atmosphere level <output id="ambient-value">20%</output></label><input id="ambient-level" type="range" min="0" max="1" step="0.01" value="0.2" />
            <div class="music-box"><span class="music-icon">♫</span><strong>Your own soundtrack</strong><span id="music-name">Bring a little of your world.</span><button id="music-button" class="file-button">Choose audio file ↗</button><input id="music-file" type="file" accept="audio/*" hidden /><button id="remove-music" class="text-button" hidden>Remove track</button></div><label class="range-heading" for="music-level">Music level <output id="music-value">40%</output></label><input id="music-level" type="range" min="0" max="1" step="0.01" value="0.4" /><p class="fine-print">Plays locally on a loop. Re-select your file after reopening.</p><div id="bwg-background-controls"></div>
          </section>
          <section class="panel ritual-panel"><span class="eyebrow">MAKE IT YOURS</span><h2>The finishing touches</h2><label for="minutes">Session length</label><div class="duration-field"><input id="minutes" type="number" min="0" max="180" step="1" value="20" /><span>minutes</span></div><p class="fine-print">0 for an open-ended session. Timed sessions fade out.</p><div id="visual-controls" tabindex="-1" role="region" aria-label="Visuals"></div><div class="save-area"><label for="preset-name">Preset name</label><input id="preset-name" maxlength="80" value="Quiet morning" /><button id="save-preset" class="save-button">Save to my presets ↗</button><button id="export" class="text-button export-button">↓ Export preset JSON</button><div class="preset-actions"><button id="share-session" class="text-button">Share session link</button><button id="render-audio" class="text-button">Export audio</button><button id="record-video" class="text-button">Export video</button></div></div></section>
          <p class="side-note">“There is no perfect frequency.<br>Only the one you enjoy.”</p>
        </div>
      </div>
      <footer class="page-footer"><span>MADE FOR CURIOUS EARS.</span><span>Original tones. Your own ritual.${import.meta.env.VITE_SOURCE_URL ? ` <a href="${e(import.meta.env.VITE_SOURCE_URL)}" target="_blank" rel="noopener noreferrer">Source code</a>` : ''}</span></footer>
    </div>
  </main><div id="notice" class="notice" role="status" aria-live="polite" hidden></div>
  <dialog id="preset-explorer" class="explorer-dialog" aria-labelledby="explorer-title"><div class="section-heading"><div><span class="eyebrow">YOUR NEXT LISTEN</span><h2 id="explorer-title">Explore presets</h2></div><button id="close-explorer" class="secondary-button">Close</button></div><p class="small-muted">Original listening recipes inspired by familiar frequency traditions. Use Load for a silent preview, or Load and play to start listening.</p><div class="explorer-filters"><label>Search<input id="preset-search" type="search" placeholder="Name, frequency or intention" /></label><label>Category<select id="preset-category"><option value="all">All categories</option></select></label></div><label class="experience-filter"><input id="preset-with-visuals" type="checkbox" /> With visual settings</label><p id="preset-count" class="small-muted" aria-live="polite"></p><div id="preset-results" class="preset-results"></div></dialog>
`;

export function builtinView(): string {
  return presets.slice(0, 6).map((p, i) => `<button class="preset-card ${i === 0 ? 'selected' : ''}" data-preset="${p.id}" title="${e(p.description)}"><span class="preset-symbol">${['☼', '≈', '☾', '⊹', '♡', '◎'][i]}</span><span><strong>${e(p.name)}</strong><small>${e(p.category)} / ${Math.abs(p.session.layers[0].right - p.session.layers[0].left)} HZ</small></span><span class="preset-arrow">↗</span></button>`).join('');
}

export function savedView(saved: Session[], preferences: { favorites: string[]; recent: string[] } = { favorites: [], recent: [] }, filter = 'all'): string {
  if (!saved.length) return '<p class="empty-library">Your next favourite sound<br>starts right here.</p>';
  const visible = saved.map((p, i) => ({ p, i })).filter(({ p }) => filter === 'all' || (filter === 'favorites' ? preferences.favorites : preferences.recent).includes(p.name));
  if (filter === 'recent') visible.sort((a, b) => preferences.recent.indexOf(a.p.name) - preferences.recent.indexOf(b.p.name));
  return visible.map(({ p, i }) => `<div class="saved-row"><button class="saved-preset" data-saved="${i}">${e(p.name)}</button><button class="preset-small-button" data-favorite="${i}" aria-label="Favorite preset ${e(p.name)}" aria-pressed="${preferences.favorites.includes(p.name)}">${preferences.favorites.includes(p.name) ? '★' : '☆'}</button><button class="preset-small-button" data-duplicate="${i}" aria-label="Duplicate preset ${e(p.name)}">⧉</button><button class="delete-preset" data-delete="${i}" aria-label="Delete preset ${e(p.name)}">×</button></div>`).join('') || '<p class="empty-library">No presets in this view.</p>';
}

export function layerView(layer: Layer, index: number, only: boolean): string {
  const routeOptions = [['binaural', 'Binaural (L / R)'], ['mixed', 'Mixed (both ears)'], ['left', 'Left ear only'], ['right', 'Right ear only']];
  return `<article class="tone-layer" data-layer="${layer.id}"><div class="layer-heading"><span class="layer-number">${String(index + 1).padStart(2, '0')}</span><input class="layer-name" data-field="name" aria-label="Layer ${index + 1} name" value="${e(layer.name)}" maxlength="80" /><button class="remove-layer" data-remove="${layer.id}" aria-label="Remove layer ${index + 1}" ${only ? 'disabled' : ''}>×</button></div><div class="frequency-inputs"><label>Left <span>Hz</span><input data-field="left" type="number" min="20" max="2000" step="0.1" value="${layer.left}" /></label><div class="beat-readout"><strong data-beat>${Math.abs(layer.right - layer.left).toFixed(1)}</strong><span>HZ DIFFERENCE</span></div><label>Right <span>Hz</span><input data-field="right" type="number" min="20" max="2000" step="0.1" value="${layer.right}" /></label></div><div class="layer-bottom"><select data-field="route" aria-label="Layer ${index + 1} channel routing">${routeOptions.map(([value, label]) => `<option value="${value}" ${value === layer.route ? 'selected' : ''}>${label}</option>`).join('')}</select><label class="layer-level">Level<input data-field="level" aria-label="Layer ${index + 1} level" type="range" min="0" max="1" step="0.01" value="${layer.level}" /><output>${Math.round(layer.level * 100)}%</output></label></div></article>`;
}

export function frequencyView(query = '', favorites = new Set<string>(), onlyFavorites = false): string {
  const terms = query.toLowerCase().trim().split(/\s+/);
  const matches = frequencies.map((f, i) => ({ f, i })).filter(({ f }) => (!onlyFavorites || favorites.has(frequencyKey(f))) && terms.every(term =>
    [f.label, f.hz, f.group, f.detail, ...f.tags, ...f.aliases].join(' ').toLowerCase().includes(term)));
  return [...new Set(matches.map(({ f }) => f.group))].map(group => `<div class="frequency-group"><h3>${e(group)}</h3><div class="frequency-chips">${matches.filter(({ f }) => f.group === group).map(({ f, i }) => `<button data-frequency="${i}" title="${e(f.detail)}"><span>${e(f.label)}</span><strong>${f.hz}<small> Hz</small></strong><small class="frequency-kind">${f.kind === 'beat' ? 'Beat difference' : 'Carrier tone'}${favorites.has(frequencyKey(f)) ? '<span class="favorite-mark" role="img" aria-label="Favorite">★</span>' : ''}</small></button>`).join('')}</div></div>`).join('') || `<p class="small-muted">${onlyFavorites ? 'No favorites match. Select a frequency, then favorite it in its details.' : 'No matching frequencies. Try another name or number.'}</p>`;
}

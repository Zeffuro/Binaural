import { escapeHtml as e, type Session } from './model';
import { importBwg } from './import/bwg';
import { splitBwgLibrary } from './import/bwg-library';

export async function readBwg(file: File, load: (session: Session) => Promise<void>): Promise<void> {
  if (file.size > 8 * 1024 * 1024) throw new Error('BWGen files must be smaller than 8 MB.');
  const entries = splitBwgLibrary(await file.arrayBuffer());
  const dialog = document.createElement('dialog');
  dialog.className = 'explorer-dialog import-dialog';
  dialog.setAttribute('aria-label', 'Review BWGen import');
  dialog.innerHTML = `<h2>Review BWGen import</h2>
    ${entries.length > 1 ? `<label for="bwg-preset">Choose a preset from this library (${entries.length})</label><select id="bwg-preset">${entries.map((entry, index) => `<option value="${index}">${e(entry.preset.name)}</option>`).join('')}</select>` : ''}
    <div id="bwg-review"></div><p class="small-muted">Imported from ${e(file.name)}. Nothing plays until you start listening.</p>
    <div class="import-actions"><button class="save-button" id="accept-import">Load imported session</button><button class="secondary-button" id="cancel-import">Cancel</button></div>`;
  const button = dialog.querySelector<HTMLButtonElement>('#accept-import')!;
  let result: ReturnType<typeof importBwg> | undefined;
  const review = (index: number): void => {
    try {
      result = importBwg(entries[index].data);
      button.disabled = false;
      dialog.querySelector('#bwg-review')!.innerHTML = `<h3>${e(result.session.name)}</h3><p>${e(result.summary)}</p>
        ${result.session.source?.description ? `<details><summary>Original description</summary><p class="original-description">${e(result.session.source.description)}</p></details>` : ''}
        <h3>Import notes</h3><ul>${result.warnings.map(warning => `<li>${e(warning)}</li>`).join('')}</ul>`;
    } catch (error) {
      result = undefined;
      button.disabled = true;
      dialog.querySelector('#bwg-review')!.textContent = error instanceof Error ? error.message : 'Cannot import this preset.';
    }
  };
  review(0);
  dialog.querySelector('#bwg-preset')?.addEventListener('change', event => review(Number((event.target as HTMLSelectElement).value)));
  document.body.append(dialog);
  dialog.querySelector('#cancel-import')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  button.addEventListener('click', async () => {
    if (!result) return;
    button.disabled = true;
    try { await load(result.session); dialog.close(); }
    catch (error) { button.disabled = false; dialog.querySelector('#bwg-review')!.textContent = error instanceof Error ? error.message : 'Could not load this session.'; }
  });
  dialog.showModal();
}

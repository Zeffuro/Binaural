import type { Session } from './model';
import { decodeBwg } from './import/bwg-program';
import { backgroundReference, type BackgroundSource } from './import/bwg-background';
import { backgroundAssets } from './background-assets';
import { generatedBackgrounds } from './audio/generated-backgrounds';

export function setupBackgrounds(options: {
  session: () => Session;
  notify: (message: string) => void;
  busy: (value: boolean) => void;
  source: (value: BackgroundSource) => void;
}): { refresh: () => void; transport: (locked: boolean) => void } {
  const root = document.querySelector<HTMLElement>('#bwg-background-controls')!;
  root.innerHTML = `<details><summary>BWGen background sounds</summary>
    <p class="small-muted" id="bwg-background-status">Built-in sounds are ready to play.</p>
    <label id="bwg-source-label" for="bwg-background-source" hidden>Background source</label>
    <select id="bwg-background-source" hidden><option value="auto">Automatic</option><option value="generated">Built-in sound</option><option value="recording">Imported recording only</option></select>
    <p class="fine-print" id="bwg-background-count"></p>
    <button class="file-button" id="bwg-pack-button">Import BWGen sound pack (.dll)</button>
    <input type="file" id="bwg-pack-file" accept=".dll" hidden />
    <button class="file-button" id="bwg-wave-button" hidden>Use a WAV for this background</button>
    <input type="file" id="bwg-wave-file" accept=".wav,audio/wav" hidden />
    <button class="text-button" id="bwg-clear-assets" hidden>Remove imported background recordings</button>
    <p class="fine-print">Imported recordings stay in this browser and are not included in preset backups.</p></details>`;
  const get = <T extends HTMLElement = HTMLElement>(selector: string): T => root.querySelector<T>(selector)!;
  let locked = false, working = false, revision = 0;
  const transport = (value: boolean): void => {
    locked = value;
    root.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button, select').forEach(input => { input.disabled = locked || working; });
  };
  const refresh = async (): Promise<void> => {
    const token = ++revision;
    const session = options.session();
    const preset = session.bwg ? decodeBwg(session.bwg).preset : undefined;
    const reference = preset && backgroundReference(preset);
    await backgroundAssets.ready;
    const binding = preset && await backgroundAssets.resolve(preset, session.bwgBackgroundSource);
    if (token !== revision) return;
    get('#bwg-wave-button').hidden = !reference;
    get('#bwg-source-label').hidden = get('#bwg-background-source').hidden = !reference;
    get<HTMLSelectElement>('#bwg-background-source').value = session.bwgBackgroundSource ?? 'auto';
    get<HTMLOptionElement>('#bwg-background-source option[value="generated"]').disabled = !reference?.approximation;
    get('#bwg-clear-assets').hidden = backgroundAssets.count === 0;
    get('#bwg-background-count').textContent = `${generatedBackgrounds.length} built-in sounds. ${backgroundAssets.count} imported recordings${backgroundAssets.persistent ? '.' : ', available for this tab only.'}`;
    get('#bwg-background-status').textContent = reference
      ? binding ? `${binding.kind === 'generated' ? 'Built-in' : 'Ready'}: ${binding.name}.`
        : `Missing: ${reference.name} (${reference.file}). ${session.bwgBackgroundSource === 'generated' ? 'No built-in sound matches. Choose Automatic or Imported recording only and link a WAV.' : 'Import its sound pack or choose a replacement WAV.'}`
      : 'Load a BWGen preset to match its background automatically.';
    if (reference) get<HTMLDetailsElement>('details').open = true;
  };
  const operate = async (action: () => Promise<string>): Promise<void> => {
    if (locked || working) return;
    working = true;
    options.busy(true);
    transport(locked);
    try { options.notify(await action()); }
    catch (error) { options.notify(error instanceof Error ? error.message : 'The background could not be loaded.'); }
    finally { working = false; options.busy(false); transport(locked); void refresh().catch(error => options.notify(String(error))); }
  };
  get('#bwg-pack-button').addEventListener('click', () => get<HTMLInputElement>('#bwg-pack-file').click());
  get('#bwg-wave-button').addEventListener('click', () => get<HTMLInputElement>('#bwg-wave-file').click());
  get('#bwg-background-source').addEventListener('change', event => {
    if (locked || working) return;
    options.source((event.target as HTMLSelectElement).value as BackgroundSource);
    void refresh().catch(error => options.notify(String(error)));
  });
  get('#bwg-pack-file').addEventListener('change', event => {
    const input = event.target as HTMLInputElement, file = input.files?.[0];
    input.value = '';
    if (file) void operate(async () => `${await backgroundAssets.importPack(file)} background recordings imported locally.`);
  });
  get('#bwg-wave-file').addEventListener('change', event => {
    const input = event.target as HTMLInputElement, file = input.files?.[0];
    input.value = '';
    const session = options.session();
    if (file && session.bwg) void operate(async () => {
      await backgroundAssets.bindWave(decodeBwg(session.bwg).preset, file);
      return `Background linked to ${file.name}. Its playback follows the imported BWGen timeline.`;
    });
  });
  get('#bwg-clear-assets').addEventListener('click', () => { void operate(async () => {
    await backgroundAssets.clear();
    return 'Imported background recordings removed from this browser.';
  }); });
  return { refresh: () => { void refresh().catch(error => options.notify(String(error))); }, transport };
}

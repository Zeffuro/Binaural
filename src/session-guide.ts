import { presets } from './catalog';
import { parseSession, type Session } from './model';
import { defaultVisualSettings } from './visual-state';
import './discovery.css';

export function guidedSession(intent: string, minutes: number, scene: string): Session {
  const recipe = ({ unwind: 'morning', focus: 'beta-low', explore: 'octaves', background: 'tide' } as Record<string, string>)[intent];
  if (!recipe || ![10, 20, 30].includes(minutes) || !['off', 'aurora', 'nature:forest-slope', 'spectrum'].includes(scene)) throw new Error('Choose one of the available session options.');
  const session = parseSession(presets.find(item => item.id === recipe)!.session);
  session.version = 2; session.minutes = minutes; session.master = .15;
  session.tonesMuted = intent === 'background';
  if (intent === 'background') session.name = 'A little ocean';
  session.visual = { ...defaultVisualSettings(), scene };
  return session;
}

export function setupSessionGuide(options: { load(session: Session): Promise<void>; start(): Promise<void> }): void {
  const opener = document.createElement('button'); opener.id = 'session-guide'; opener.className = 'text-button'; opener.textContent = 'Help me choose';
  document.querySelector('.studio-tools')!.append(opener);
  const dialog = document.createElement('dialog'); dialog.className = 'explorer-dialog session-guide'; dialog.setAttribute('aria-labelledby', 'guide-title');
  dialog.innerHTML = `<h2 id="guide-title">Make a little listening space</h2>
    <p>Headphones keep left and right tones separate. Start with low device volume and adjust to a comfortable level.</p>
    <form><label for="guide-intent">Start with</label><select id="guide-intent"><option value="unwind">Unwind</option><option value="focus">Focus</option><option value="explore">Explore tones</option><option value="background">Background only</option></select>
    <label for="guide-duration">How long?</label><select id="guide-duration"><option value="10">10 minutes</option><option value="20" selected>20 minutes</option><option value="30">30 minutes</option></select>
    <label for="guide-visual">A visual atmosphere</label><select id="guide-visual"><option value="off">No visuals</option><option value="aurora">Calm aurora</option><option value="nature:forest-slope">Forest panorama</option><option value="spectrum">Music spectrum</option></select>
    <p id="guide-summary" class="fine-print"></p><p class="fine-print">These are creative starting points, without a promised mental effect. You can change every setting afterwards.</p>
    <p id="guide-status" role="status"></p><div class="preset-actions"><button type="submit" class="save-button" value="load">Load session</button><button type="submit" class="secondary-button" value="play">Start session</button><button type="button" id="close-guide" class="text-button">Cancel</button></div></form>`;
  document.body.append(dialog);
  const input = (id: string) => dialog.querySelector<HTMLSelectElement>(id)!;
  const form = dialog.querySelector('form')!;
  const status = dialog.querySelector('#guide-status')!;
  let revision = 0, pending = false;
  function summary(): void {
    const session = guidedSession(input('#guide-intent').value, Number(input('#guide-duration').value), input('#guide-visual').value);
    dialog.querySelector('#guide-summary')!.textContent = session.tonesMuted ? 'Synthetic ocean only. Tone layers start muted.' : session.layers.map(layer => `${layer.left} / ${layer.right} Hz`).join(', ') + `. ${session.ambient === 'none' ? 'Tones only.' : 'Includes a soft background.'}`;
  }
  opener.onclick = () => { if (!pending) { status.textContent = ''; summary(); dialog.showModal(); } };
  dialog.querySelector('#close-guide')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { revision++; });
  form.addEventListener('change', summary);
  form.addEventListener('submit', event => {
    event.preventDefault(); if (pending) return;
    const ticket = ++revision;
    const play = (event as SubmitEvent).submitter?.getAttribute('value') === 'play';
    const session = guidedSession(input('#guide-intent').value, Number(input('#guide-duration').value), input('#guide-visual').value);
    pending = true; status.textContent = 'Loading your session…';
    const fields = form.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('select, button[type=submit]'); fields.forEach(field => { field.disabled = true; });
    void options.load(session).then(async () => {
      if (ticket !== revision || !dialog.open) return;
      if (play) await options.start();
      if (ticket === revision && dialog.open) { dialog.close(); document.querySelector<HTMLElement>('#transport')!.focus(); }
    }).catch(error => { if (ticket === revision) status.textContent = error instanceof Error ? error.message : 'This session could not load. Try again.'; })
      .finally(() => { pending = false; fields.forEach(field => { field.disabled = false; }); });
  });
}

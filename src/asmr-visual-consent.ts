const preferenceKey = 'binaural:asmr-soft-visual-approval:v2';
type Decision = { allowed: boolean; remember: boolean };

export function setupAsmrVisualConsent() {
  let pending: { dialog: HTMLDialogElement; finish(decision: Decision): void } | undefined;
  const cancel = () => pending?.finish({ allowed: false, remember: false });
  return {
    cancel,
    remembered(): boolean {
      try { return localStorage.getItem(preferenceKey) === 'soft-slow'; } catch { return false; }
    },
    remember() { try { localStorage.setItem(preferenceKey, 'soft-slow'); } catch { /* Tab approval still works without storage. */ } },
    revoke() { cancel(); try { localStorage.removeItem(preferenceKey); } catch { /* Storage can be disabled. */ } },
    request(): Promise<Decision> {
      cancel();
      return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        dialog.className = 'asmr-visual-consent'; dialog.setAttribute('aria-labelledby', 'asmr-visual-consent-title');
        dialog.setAttribute('aria-describedby', 'asmr-visual-consent-description');
        dialog.innerHTML = '<h2 id="asmr-visual-consent-title">Moving visual trigger</h2><p id="asmr-visual-consent-description">Moving lights, mirrored patterns and sound-reactive pulses can be uncomfortable for photosensitive viewers. Fast sounds can produce rapid pulses. Starts at low brightness and respects your reduced-motion settings. Motion follows playback or Animate without audio.</p><label class="asmr-visual-remember"><input type="checkbox" /> Remember this choice on this browser</label><p class="fine-print">Remembering allows soft ASMR visuals only when you choose sounds + lights. Advanced bright lights and MilkDrop remain separate.</p><div class="asmr-visual-consent-actions"><button type="button" class="save-button" data-accept>Start visual</button><button type="button" class="secondary-button" data-decline>Not now</button></div>';
        const finish = (decision: Decision) => {
          if (pending?.dialog !== dialog) return;
          pending = undefined; dialog.close(); dialog.remove(); resolve(decision);
        };
        pending = { dialog, finish };
        dialog.querySelector('[data-accept]')!.addEventListener('click', () => finish({ allowed: true, remember: dialog.querySelector('input')!.checked }));
        dialog.querySelector('[data-decline]')!.addEventListener('click', cancel);
        dialog.addEventListener('cancel', event => { event.preventDefault(); event.stopPropagation(); cancel(); });
        dialog.addEventListener('close', () => finish({ allowed: false, remember: false }));
        document.body.append(dialog);
        try { dialog.showModal(); dialog.querySelector<HTMLButtonElement>('[data-accept]')!.focus(); }
        catch { finish({ allowed: false, remember: false }); }
      });
    },
  };
}

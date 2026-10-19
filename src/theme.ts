type Appearance = 'system' | 'light' | 'dark';

const storageKey = 'binaural.appearance';
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
let appearance: Appearance = 'system';
try {
  const stored = localStorage.getItem(storageKey);
  if (stored === 'light' || stored === 'dark') appearance = stored;
} catch { /* Appearance still works when browser storage is unavailable. */ }

function applyTheme(): void {
  const theme = appearance === 'system' ? (systemTheme.matches ? 'dark' : 'light') : appearance;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

applyTheme();
systemTheme.addEventListener('change', () => {
  if (appearance === 'system') applyTheme();
});

export function setupTheme(): void {
  if (document.querySelector('#site-theme')) return;
  const control = document.createElement('label');
  control.className = 'appearance-control';
  control.htmlFor = 'site-theme';
  control.innerHTML = '<span id="site-theme-label">Appearance</span><select id="site-theme" aria-labelledby="site-theme-label"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select>';
  const select = control.querySelector('select')!;
  select.value = appearance;
  select.addEventListener('change', () => {
    appearance = select.value as Appearance;
    try { localStorage.setItem(storageKey, appearance); } catch { /* Keep the tab preference. */ }
    applyTheme();
  });
  document.querySelector('.topbar')!.append(control);
}

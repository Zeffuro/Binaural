export function browserLaunchOptions(name, environment = process.env, platform = process.platform, allowHeaded = false) {
  const hosted = name === 'firefox' && platform === 'linux' && environment.GITHUB_ACTIONS === 'true' && environment.BINAURAL_CI_DISPLAY === 'xvfb';
  if (!hosted && !allowHeaded) return { headless: true };
  const privateDisplay = /^:[1-9]\d*(?:\.\d+)?$/.test(environment.DISPLAY ?? '');
  const wsl = !!(environment.WSL_DISTRO_NAME || environment.WSL_INTEROP);
  if (hosted || (platform === 'linux' && wsl)) {
    if (!privateDisplay) throw new Error('Headed automation requires a private Xvfb DISPLAY other than :0.');
  }
  if (platform !== 'linux') return { headless: false };
  // Force X11 so inherited WSLg Wayland cannot bypass the private display.
  const env = Object.fromEntries(Object.entries(environment).filter(([, value]) => typeof value === 'string'));
  Object.assign(env, { WAYLAND_DISPLAY: '', MOZ_ENABLE_WAYLAND: '0', GDK_BACKEND: 'x11' });
  return { headless: false, env, ...(name === 'firefox' ? { firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.forbid-software': false } } : {}) };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { browserLaunchOptions } from './browser-options.mjs';
import { testInvocation } from './test-browser.mjs';

test('default invocation preserves file selectors while enforcing quick mode and one worker', () => {
  const value = testInvocation(['tests/asmr-audio.spec.ts'], { PWDEBUG: '1', BINAURAL_TEST_MODE: 'full' });
  assert.equal(value.env.BINAURAL_TEST_MODE, 'quick');
  assert.equal(value.env.PWDEBUG, undefined);
  assert.deepEqual(value.args, ['test', 'tests/asmr-audio.spec.ts', '--workers=1']);
});

test('full mode is explicit and preserves requested concurrency', () => {
  const value = testInvocation(['--full', '--workers=1'], {});
  assert.equal(value.env.BINAURAL_TEST_MODE, 'full');
  assert.deepEqual(value.args, ['test', '--workers=1']);
});

test('default commands reject configuration, concurrency and visible browser overrides', () => {
  for (const value of ['--headed', '--debug', '--ui', '--ui-port=9222', '--workers=2', '-j2', '--config=other.ts', '-cother.ts']) {
    assert.throws(() => testInvocation([value], {}));
  }
  assert.throws(() => testInvocation(['--full', '--headed'], {}));
});

test('headed mode requires its separate explicit flag', () => {
  assert.equal(testInvocation(['--full', '--allow-headed'], {}).env.BINAURAL_TEST_MODE, 'headed');
  assert.deepEqual(browserLaunchOptions('firefox', {}, 'win32'), { headless: true });
  assert.deepEqual(browserLaunchOptions('firefox', {}, 'win32', true), { headless: false });
});

test('generic CI and inherited WSLg never enable headed launches', () => {
  for (const name of ['chromium', 'firefox']) {
    const env = { CI: 'true', DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0', WSL_DISTRO_NAME: 'Ubuntu', BINAURAL_CI_DISPLAY: 'xvfb' };
    assert.deepEqual(browserLaunchOptions(name, env, 'linux'), { headless: true });
  }
});

test('hosted headed Firefox requires the explicit flag and a private display', () => {
  assert.deepEqual(browserLaunchOptions('firefox', { GITHUB_ACTIONS: 'true', DISPLAY: ':99' }, 'linux'), { headless: true });
  for (const display of ['', ':0', ':0.0', 'localhost:0']) {
    assert.throws(() => browserLaunchOptions('firefox', { GITHUB_ACTIONS: 'true', BINAURAL_CI_DISPLAY: 'xvfb', DISPLAY: display }, 'linux'));
  }
});

test('private hosted launches force X11 and remove the inherited Wayland route', () => {
  const env = { GITHUB_ACTIONS: 'true', BINAURAL_CI_DISPLAY: 'xvfb', DISPLAY: ':99', WAYLAND_DISPLAY: 'wayland-0', MOZ_ENABLE_WAYLAND: '1' };
  const value = browserLaunchOptions('firefox', env, 'linux');
  assert.equal(value.headless, false);
  assert.equal(value.env.DISPLAY, ':99');
  assert.equal(value.env.WAYLAND_DISPLAY, '');
  assert.equal(value.env.MOZ_ENABLE_WAYLAND, '0');
  assert.equal(value.env.GDK_BACKEND, 'x11');
  assert.deepEqual(browserLaunchOptions('chromium', env, 'linux'), { headless: true });
  assert.equal(env.WAYLAND_DISPLAY, 'wayland-0');
});

test('explicit WSL headed mode also rejects the desktop display', () => {
  assert.throws(() => browserLaunchOptions('firefox', { WSL_DISTRO_NAME: 'Ubuntu', DISPLAY: ':0' }, 'linux', true));
});

import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function testInvocation(input, environment = process.env) {
  const args = [...input];
  const full = args[0] === '--full';
  if (full) args.shift();
  const headed = full && args[0] === '--allow-headed';
  if (headed) args.shift();
  const unsafe = args.find(arg => /^--(?:headed|debug|ui|ui-host|ui-port)(?:=|$)/.test(arg));
  if (unsafe && !headed) throw new Error(`${unsafe} requires the explicit npm run test:headed command.`);
  if (args.some(arg => /^(?:-c|--config(?:=|$))/.test(arg))) throw new Error('The test launcher uses the repository Playwright configuration.');
  if (!full && args.some(arg => /^(?:-j|--workers(?:=|$))/.test(arg))) throw new Error('npm test uses one worker; custom concurrency requires npm run test:full.');
  const env = { ...environment, BINAURAL_TEST_MODE: headed ? 'headed' : full ? 'full' : 'quick' };
  if (!headed) delete env.PWDEBUG;
  return { args: ['test', ...args, ...(!full ? ['--workers=1'] : [])], env };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const invocation = testInvocation(process.argv.slice(2));
    const child = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/playwright/cli.js', import.meta.url)), ...invocation.args], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), env: invocation.env, stdio: 'inherit', windowsHide: true,
    });
    child.on('error', error => { console.error(error.message); process.exitCode = 1; });
    child.on('exit', code => { process.exitCode = code ?? 1; });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

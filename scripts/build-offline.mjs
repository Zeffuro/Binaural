import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export function offlineBuild() {
  let output;
  return {
    name: 'binaural-offline',
    apply: 'build',
    configResolved(config) { output = resolve(config.root, config.build.outDir); },
    async closeBundle() {
      const template = await readFile(fileURLToPath(new URL('./offline-worker.js', import.meta.url)), 'utf8');
      const entries = [];
      async function walk(directory) {
        for (const item of await readdir(directory, { withFileTypes: true })) {
          const file = resolve(directory, item.name);
          if (item.isDirectory()) await walk(file);
          else if (item.isFile() && item.name !== 'sw.js') {
            const path = relative(output, file).replaceAll('\\', '/');
            const integrity = 'sha256-' + createHash('sha256').update(await readFile(file)).digest('base64');
            entries.push({ path, integrity });
          }
        }
      }
      await walk(output);
      entries.sort((a, b) => a.path.localeCompare(b.path, 'en'));
      const version = createHash('sha256').update(template).update(JSON.stringify(entries)).digest('hex').slice(0, 24);
      await writeFile(resolve(output, 'sw.js'), template.replace('__ENTRIES__', JSON.stringify(entries)).replace('__VERSION__', version));
    },
  };
}

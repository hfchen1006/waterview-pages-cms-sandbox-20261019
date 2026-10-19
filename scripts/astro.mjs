import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const command = process.argv[2];
// Delete only these fixed paths inside this POC. Never reuse a previous dist.
if (command === 'build') {
  for (const name of ['dist', '.astro', 'node_modules/.astro']) {
    const target = resolve(root, name);
    if (!target.startsWith(root)) throw new Error('Unsafe cleanup target');
    rmSync(target, { recursive: true, force: true });
  }
}
const result = spawnSync(process.execPath, [
  fileURLToPath(new URL('../node_modules/astro/bin/astro.mjs', import.meta.url)),
  ...process.argv.slice(2),
], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);

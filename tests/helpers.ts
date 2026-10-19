import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import sharp from 'sharp';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export const publishedImages = ['published-property', 'published-studio', 'published-guide'];
export const privateImages = ['draft-property', 'hidden-property', 'draft-guide', 'hidden-guide'];
export const privateMarkers = [
  'DRAFT_PROPERTY_ONLY_SENTINEL', 'HIDDEN_PROPERTY_ONLY_SENTINEL',
  'DRAFT_GUIDE_ONLY_SENTINEL', 'HIDDEN_GUIDE_ONLY_SENTINEL',
  'DRAFT_GUIDE_BODY_ONLY_SENTINEL', 'HIDDEN_GUIDE_BODY_ONLY_SENTINEL',
  'fictional-draft-property', 'fictional-hidden-property', 'fictional-draft-guide', 'fictional-hidden-guide',
];

export async function walk(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path)); else files.push(path);
  }
  return files.sort();
}

export async function runAstro(command: 'build' | 'check') {
  return await new Promise<{ code: number; output: string }>((resolveResult, reject) => {
    const child = spawn(process.execPath, ['scripts/astro.mjs', command], {
      cwd: root, env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    child.on('error', reject);
    child.on('close', (code) => resolveResult({ code: code ?? 1, output }));
  });
}

export async function outputAudit(expectedImages = publishedImages, extraForbiddenImages: string[] = [], extraMarkers: string[] = []) {
  const dist = resolve(root, 'dist');
  const files = await walk(dist);
  assert.deepEqual(files.filter((file) => file.endsWith('.html')).map((file) => relative(dist, file)), ['index.html']);
  const html = await readFile(resolve(dist, 'index.html'), 'utf8');
  const forbiddenNames = [...privateImages, ...extraForbiddenImages];
  const forbiddenMarkers = [...privateMarkers, ...extraMarkers];
  const forbiddenHashes = new Set<string>();
  const forbiddenPixels = new Set<string>();
  for (const name of forbiddenNames) {
    const input = await readFile(resolve(root, `src/assets/uploads/${name}.png`));
    const transformed = await sharp(input).resize({ width: 640, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    for (const bytes of [input, transformed]) {
      forbiddenHashes.add(hash(bytes));
      forbiddenPixels.add(hash(await sharp(bytes).ensureAlpha().raw().toBuffer()));
    }
  }
  const inventory: { path: string; bytes: number; sha256: string; image: boolean }[] = [];
  for (const file of files) {
    const bytes = await readFile(file);
    const path = relative(dist, file).replaceAll('\\', '/');
    const digest = hash(bytes);
    assert.equal(forbiddenHashes.has(digest), false, `Forbidden original/transformed bytes: ${path}`);
    for (const marker of [...forbiddenMarkers, ...forbiddenNames]) {
      assert.equal(path.includes(marker) || bytes.includes(Buffer.from(marker)), false, `Forbidden marker ${marker}: ${path}`);
    }
    // Decode image bytes regardless of extension. This also catches renamed files.
    let pixels: Buffer | undefined;
    try { pixels = await sharp(bytes).ensureAlpha().raw().toBuffer(); } catch { /* non-image file */ }
    if (pixels) assert.equal(forbiddenPixels.has(hash(pixels)), false, `Forbidden decoded pixels: ${path}`);
    assert.equal(/\.(json|map|md|ts)$/.test(path), false, `Internal file in public output: ${path}`);
    inventory.push({ path, bytes: bytes.length, sha256: digest, image: Boolean(pixels) });
  }
  const expectedPaths = expectedImages.flatMap((name) => [`_media/${name}.png`, `_media/${name}.webp`]).sort();
  assert.deepEqual(inventory.filter((file) => file.image).map((file) => file.path).sort(), expectedPaths);
  for (const name of expectedImages) {
    const input = await readFile(resolve(root, `src/assets/uploads/${name}.png`));
    assert.deepEqual(await readFile(resolve(dist, `_media/${name}.png`)), input, 'Published original matches its fixture');
    const transformed = await sharp(input).resize({ width: 640, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    assert.deepEqual(await readFile(resolve(dist, `_media/${name}.webp`)), transformed, 'Published transform matches its fixture');
    assert.ok(html.includes(`src="/_media/${name}.png"`), `Original is rendered: ${name}`);
    assert.ok(html.includes(`srcset="/_media/${name}.webp"`), `Transform is rendered: ${name}`);
  }
  return { html, inventory, forbiddenNames, forbiddenMarkers, forbiddenByteHashesChecked: forbiddenHashes.size, forbiddenPixelHashesChecked: forbiddenPixels.size };
}

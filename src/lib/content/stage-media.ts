import { readdir, readFile, mkdir, rm, realpath, lstat, copyFile } from 'node:fs/promises';
import { dirname, resolve, relative, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import sharp from 'sharp';
import {
  propertyStorageSchema, articleStorageSchema, readyProperty, readyArticle,
  uploadPath, type ContentImage,
} from './schemas.ts';
import { validateMarkdown } from './markdown-security.ts';

export const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));

export async function resolveUpload(src: string, root = projectRoot) {
  uploadPath.parse(src);
  const permitted = await realpath(resolve(root, 'src/assets/uploads'));
  const canonicalRoot = await realpath(root);
  if (relative(canonicalRoot, permitted) !== ['src', 'assets', 'uploads'].join(sep)) {
    throw new Error('Uploads directory must stay inside the POC; directory links are forbidden');
  }
  const requested = resolve(root, src);
  if ((await lstat(requested)).isSymbolicLink()) throw new Error('Symlink images are forbidden');
  const actual = await realpath(requested);
  const local = relative(permitted, actual);
  if (local === '..' || local.startsWith(`..${sep}`) || resolve(permitted, local) !== actual || local.includes(sep)) {
    throw new Error('Image escapes the permitted uploads directory');
  }
  if (!(await lstat(actual)).isFile()) throw new Error('Image is not a regular file');
  return actual;
}

export function parseArticle(source: string) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error('Article requires YAML frontmatter');
  return { data: articleStorageSchema.parse(parse(match[1])), body: match[2] };
}

// A small allowlist staging step, not an external publishing system. Both this
// step and Content Collections use the same Zod schemas. No image() schema or
// Vite upload glob imports can cause unpublished uploads to be bundled.
export async function stagePublishedMedia(root = projectRoot) {
  const stage = resolve(root, '.poc-media');
  const expectedStage = resolve(root, '.poc-media');
  if (dirname(stage) !== resolve(root) || stage !== expectedStage) throw new Error('Unsafe staging path');
  // Remove stale staged media even if subsequent validation fails.
  await rm(stage, { recursive: true, force: true });
  const selected = new Map<string, ContentImage>();
  const propertyIds = new Set<string>();
  const slugs = new Set<string>();
  for (const name of (await readdir(resolve(root, 'src/content/properties'))).sort()) {
    if (!name.endsWith('.json')) continue;
    const data = propertyStorageSchema.parse(JSON.parse(await readFile(resolve(root, 'src/content/properties', name), 'utf8')));
    if (propertyIds.has(data.propertyId)) throw new Error(`Duplicate property ID: ${data.propertyId}`);
    propertyIds.add(data.propertyId);
    for (const image of data.images ?? []) await resolveUpload(image.src, root);
    if (data.publicationStatus === 'published') {
      for (const image of readyProperty(data).images) selected.set(image.src, image);
    }
  }
  for (const name of (await readdir(resolve(root, 'src/content/neighborhoods'))).sort()) {
    if (!name.endsWith('.md')) continue;
    const { data, body } = parseArticle(await readFile(resolve(root, 'src/content/neighborhoods', name), 'utf8'));
    await validateMarkdown(body);
    if (slugs.has(data.slug)) throw new Error(`Duplicate article slug: ${data.slug}`);
    slugs.add(data.slug);
    if (data.coverImage) await resolveUpload(data.coverImage.src, root);
    if (data.publicationStatus === 'published') {
      const image = readyArticle(data, body).coverImage;
      if (image) selected.set(image.src, image);
    }
  }
  await mkdir(resolve(stage, '_media'), { recursive: true });
  for (const src of selected.keys()) {
    const input = await resolveUpload(src, root);
    const output = resolve(stage, '_media', basename(src));
    await copyFile(input, output);
    await sharp(input).resize({ width: 640, withoutEnlargement: true }).webp({ quality: 80 }).toFile(output.replace(/\.png$/, '.webp'));
  }
  return [...selected.keys()];
}

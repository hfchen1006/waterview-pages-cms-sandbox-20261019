import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, copyFile, symlink, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import {
  propertyStorageSchema, propertyReadySchema, articleStorageSchema, articleReadySchema,
  imageSchema, dateOnly, sourceSchema, readyArticle,
} from '../src/lib/content/schemas.ts';
import { validateMarkdown } from '../src/lib/content/markdown-security.ts';
import { parseArticle, resolveUpload, projectRoot } from '../src/lib/content/stage-media.ts';

const property = JSON.parse(await readFile(new URL('../src/content/properties/published-property.json', import.meta.url), 'utf8'));
const studio = JSON.parse(await readFile(new URL('../src/content/properties/published-studio.json', import.meta.url), 'utf8'));
const article = parseArticle(await readFile(new URL('../src/content/neighborhoods/published-guide.md', import.meta.url), 'utf8'));

test('missing publication status defaults to draft; minimal drafts are stored', () => {
  assert.deepEqual(propertyStorageSchema.parse({ propertyId: 'minimal-draft' }), { propertyId: 'minimal-draft', publicationStatus: 'draft' });
  assert.equal(articleStorageSchema.parse({ slug: 'unfinished-guide' }).publicationStatus, 'draft');
});
test('unknown, null, and blank publication states are rejected', () => {
  for (const publicationStatus of ['Published', 'invalid', '', null]) {
    assert.equal(propertyStorageSchema.safeParse({ ...property, publicationStatus }).success, false);
    assert.equal(articleStorageSchema.safeParse({ ...article.data, publicationStatus }).success, false);
  }
});
test('studio zero and fractional bathrooms are preserved', () => {
  assert.equal(propertyReadySchema.parse(studio).bedrooms, 0);
  assert.equal(propertyReadySchema.parse(property).bathrooms, 1.5);
});
test('numeric nulls remain null and empty strings cannot become zero', () => {
  for (const field of ['monthlyRent', 'bedrooms', 'bathrooms', 'squareFeet']) {
    assert.equal(propertyReadySchema.parse({ ...property, [field]: null })[field as 'monthlyRent'], null);
    for (const invalid of ['', ' ', '0', -1, Number.NaN, Infinity]) {
      assert.equal(propertyStorageSchema.safeParse({ ...property, [field]: invalid }).success, false, `${field}: ${invalid}`);
    }
  }
  assert.equal(propertyReadySchema.parse(studio).monthlyRent, null);
});
test('bedrooms must be integral; zero rent and measurements are accepted without coercion', () => {
  assert.equal(propertyStorageSchema.safeParse({ ...property, bedrooms: 0.5 }).success, false);
  assert.equal(propertyReadySchema.parse({ ...property, monthlyRent: 0, squareFeet: 0 }).monthlyRent, 0);
});
test('availability is independent of publication state', () => {
  for (const publicationStatus of ['published', 'draft', 'hidden']) {
    for (const availability of ['available', 'coming-soon', 'unavailable']) {
      assert.equal(propertyStorageSchema.parse({ ...property, publicationStatus, availability }).availability, availability);
    }
  }
});
test('every property display field is required before publication', () => {
  for (const field of ['title', 'location', 'monthlyRent', 'bedrooms', 'bathrooms', 'squareFeet', 'availability', 'description', 'images']) {
    const data = { ...property }; delete data[field];
    assert.equal(propertyStorageSchema.safeParse(data).success, true);
    assert.equal(propertyReadySchema.safeParse(data).success, false, field);
  }
  assert.equal(propertyReadySchema.safeParse({ ...property, images: [] }).success, false);
});
test('calendar dates reject rollover, timestamps, blank input, and invalid leap days', () => {
  for (const valid of ['2024-02-29', '2026-10-16', '2000-02-29']) assert.equal(dateOnly.parse(valid), valid);
  for (const invalid of ['2026-02-29', '2026-04-31', '1900-02-29', '2026-13-01', '2026-00-01', '2026-01-00', '2026-1-01', '2026-01-01T00:00:00Z', '', 'nonsense']) {
    assert.equal(dateOnly.safeParse(invalid).success, false, invalid);
  }
});
test('nullable dates are preserved; missing draft dates are not invented', () => {
  assert.equal(articleReadySchema.parse(article.data).updatedDate, null);
  assert.equal(articleStorageSchema.parse({ slug: 'draft-guide' }).updatedDate, undefined);
});
test('published editorial metadata, sources, and Markdown body are required', () => {
  for (const field of ['title', 'area', 'summary', 'updatedDate', 'sources']) {
    const data: Record<string, unknown> = { ...article.data }; delete data[field];
    assert.equal(articleStorageSchema.safeParse(data).success, true);
    assert.equal(articleReadySchema.safeParse(data).success, false, field);
  }
  assert.equal(articleReadySchema.safeParse({ ...article.data, sources: [] }).success, false);
  assert.throws(() => readyArticle(article.data, '   '));
  assert.equal(readyArticle(article.data, article.body).slug, 'fictional-lantern-quarter');
});
test('slugs are stable, explicit, and safe identifiers', () => {
  assert.equal(articleStorageSchema.parse({ slug: 'a-stable-slug' }).slug, 'a-stable-slug');
  for (const slug of ['../secret', 'has spaces', '', 'https://example.invalid']) {
    assert.equal(articleStorageSchema.safeParse({ slug }).success, false);
  }
});
test('source references require titles and HTTPS URLs without credentials', () => {
  for (const url of ['javascript:alert(1)', 'http://example.invalid', '/local', 'nonsense', 'https://user:pass@example.invalid']) {
    assert.equal(sourceSchema.safeParse({ title: 'A source', url }).success, false);
  }
  assert.equal(sourceSchema.safeParse({ title: '', url: 'https://example.invalid' }).success, false);
});
test('supplied images require meaningful alt text and authorization metadata, even in drafts', () => {
  const image = property.images[0];
  for (const alt of ['', 'photo', 'placeholder', '          ', 'image 12345']) {
    assert.equal(imageSchema.safeParse({ ...image, alt }).success, false);
  }
  for (const usage of [undefined, {}, { authorization: 'unknown' }, { ...image.usage, authorizationReference: '' }]) {
    assert.equal(imageSchema.safeParse({ ...image, usage }).success, false);
  }
  assert.equal(imageSchema.parse(image).alt, image.alt);
});
test('image paths cannot escape uploads or use arbitrary local paths or remote URLs', async () => {
  for (const src of ['../secret.png', 'src/assets/uploads/../secret.png', '/src/assets/uploads/a.png', resolve(projectRoot, 'outside-upload.png'), 'https://example.invalid/a.png', '//example.invalid/a.png', 'src/assets/uploads/%2e%2e.png', 'src/assets/uploads/a.svg', 'src/assets/uploads/nested/a.png', 'src\\assets\\uploads\\a.png']) {
    await assert.rejects(resolveUpload(src), src);
  }
  assert.match(await resolveUpload(property.images[0].src), /published-property\.png$/);
  await assert.rejects(resolveUpload('src/assets/uploads/missing.png'));
  // A junction is supported on Windows without file-symlink privileges. Its
  // destination stays inside the POC, outside only the test's permitted uploads.
  const temporary = await mkdtemp(resolve(projectRoot, '.path-test-'));
  try {
    const fakeRoot = resolve(temporary, 'fake-project');
    const destination = resolve(temporary, 'elsewhere');
    await mkdir(resolve(fakeRoot, 'src/assets'), { recursive: true });
    await mkdir(destination);
    await copyFile(await resolveUpload(property.images[0].src), resolve(destination, 'test.png'));
    await symlink(destination, resolve(fakeRoot, 'src/assets/uploads'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(resolveUpload('src/assets/uploads/test.png', fakeRoot), /directory links are forbidden/);
  } finally {
    assert.ok(resolve(temporary).startsWith(resolve(projectRoot) + sep));
    await rm(temporary, { recursive: true, force: true });
  }
});
test('article body cannot bypass structured image fields or inject raw HTML', async () => {
  for (const body of ['![caption](../assets/uploads/draft-guide.png)', '![reference][image]\n\n[image]: /image.png', '<img src="https://example.invalid/a.png">', '<script>alert(1)</script>']) {
    await assert.rejects(validateMarkdown(body), /structured coverImage/);
  }
  await assert.doesNotReject(validateMarkdown(article.body));
});

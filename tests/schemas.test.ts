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
import { cmsPropertyStorageSchema, cmsArticleStorageSchema, parseCmsArticleSource } from '../src/lib/content/cms-compat.ts';
import { parse as parseYaml } from 'yaml';

const property = JSON.parse(await readFile(new URL('../src/content/properties/published-property.json', import.meta.url), 'utf8'));
// Hosted Save added state markers; canonical tests consume the normalized record.
const studio = cmsPropertyStorageSchema.parse(JSON.parse(await readFile(new URL('../src/content/properties/published-studio.json', import.meta.url), 'utf8')));
const article = parseArticle(await readFile(new URL('../src/content/neighborhoods/published-guide.md', import.meta.url), 'utf8'));
const measurements = ['monthlyRent', 'bedrooms', 'bathrooms', 'squareFeet'] as const;

test('CMS compatibility preserves legacy fixtures without state fields or mutation', () => {
  for (const fixture of [property, studio]) {
    const input = Object.freeze({ ...fixture });
    assert.deepEqual(cmsPropertyStorageSchema.parse(input), propertyStorageSchema.parse(fixture));
  }
  assert.deepEqual(cmsArticleStorageSchema.parse(Object.freeze({ ...article.data })), article.data);
});

for (const field of measurements) {
  const stateKey = `${field}State`;
  test(`CMS ${field}: legacy, Known and Not Set retain zero and positive numbers`, () => {
    for (const value of [0, 1, 1250, ...(field === 'bedrooms' ? [] : [1.5])]) {
      for (const state of [undefined, 'known', 'not-set']) {
        const input = Object.freeze({ ...property, [field]: value, ...(state ? { [stateKey]: state } : {}) });
        const data = cmsPropertyStorageSchema.parse(input);
        assert.equal(propertyReadySchema.parse(data)[field], value);
        assert.equal(Object.hasOwn(data, stateKey), false);
        assert.equal(input[field], value);
        assert.equal(input[stateKey], state);
      }
    }
    assert.equal(cmsPropertyStorageSchema.parse({ ...property, [field]: null })[field], null);
    assert.equal(cmsPropertyStorageSchema.parse({ ...property, [field]: null, [stateKey]: 'not-set' })[field], null);
  });

  test(`CMS ${field}: only explicit Unknown recovers omitted/null values`, () => {
    for (const value of [undefined, null]) {
      const input: Record<string, unknown> = { ...property, [stateKey]: 'unknown' };
      if (value === undefined) delete input[field]; else input[field] = value;
      Object.freeze(input);
      const data = cmsPropertyStorageSchema.parse(input);
      assert.equal(propertyReadySchema.parse(data)[field], null);
      assert.equal(Object.hasOwn(data, stateKey), false);
      assert.equal(Object.hasOwn(input, field), value === null, 'Adapter must not rewrite raw input');
      assert.equal(cmsPropertyStorageSchema.safeParse({ ...input, [stateKey]: 'known' }).success, false);
    }
  });

  test(`CMS ${field}: supplied values conflict with Unknown; invalid values never coerce`, () => {
    for (const value of [0, 1, 1.5, '', ' ', '0', 'null', -1, NaN, Infinity, false, {}, []]) {
      const result = cmsPropertyStorageSchema.safeParse({ ...property, [field]: value, [stateKey]: 'unknown' });
      assert.equal(result.success, false, String(value));
      if (!result.success) assert.deepEqual(result.error.issues[0].path, [field]);
    }
    for (const value of ['', ' ', '0', 'null', -1, NaN, Infinity, false, {}, [], ...(field === 'bedrooms' ? [0.5] : [])]) {
      for (const state of [undefined, 'known', 'not-set']) {
        assert.equal(cmsPropertyStorageSchema.safeParse({ ...property, [field]: value, ...(state ? { [stateKey]: state } : {}) }).success, false);
      }
    }
    for (const state of ['', 'Unknown', 'KNOWN', 'unreviewed', null, 0, false]) {
      assert.equal(cmsPropertyStorageSchema.safeParse({ ...property, [stateKey]: state }).success, false);
    }
  });

  test(`CMS ${field}: unmarked and Not Set missing values stay incomplete in every publication state`, () => {
    for (const publicationStatus of ['draft', 'hidden', 'published']) {
      for (const state of [undefined, 'not-set']) {
        const input: Record<string, unknown> = { ...property, publicationStatus, ...(state ? { [stateKey]: state } : {}) };
        delete input[field];
        Object.freeze(input);
        const data = cmsPropertyStorageSchema.parse(input);
        assert.equal(data.publicationStatus, publicationStatus);
        assert.equal(Object.hasOwn(data, field), false, 'Missing must not silently become null');
        assert.equal(Object.hasOwn(data, stateKey), false);
        assert.equal(Object.hasOwn(input, field), false);
        assert.equal(propertyReadySchema.safeParse(data).success, false);
        assert.equal(cmsPropertyStorageSchema.safeParse({ ...input, [stateKey]: 'known' }).success, false);
        const unknown = cmsPropertyStorageSchema.parse({ ...input, [stateKey]: 'unknown' });
        assert.equal(unknown[field], null);
        assert.equal(unknown.publicationStatus, publicationStatus);
        assert.equal(propertyReadySchema.safeParse(unknown).success, publicationStatus === 'published');
      }
    }
  });
}

test('CMS dates preserve verified dates and legacy nulls without inventing dates', () => {
  for (const updatedDate of ['2024-02-29', '2026-10-16', '2000-02-29']) {
    for (const state of [undefined, 'known', 'not-set']) {
      const data = cmsArticleStorageSchema.parse({ ...article.data, updatedDate, ...(state ? { updatedDateState: state } : {}) });
      assert.equal(articleReadySchema.parse(data).updatedDate, updatedDate);
      assert.equal(Object.hasOwn(data, 'updatedDateState'), false);
    }
  }
  assert.equal(cmsArticleStorageSchema.parse(article.data).updatedDate, null);
  const notSetNull = cmsArticleStorageSchema.parse({ ...article.data, updatedDate: null, updatedDateState: 'not-set' });
  assert.equal(notSetNull.updatedDate, null);
  assert.equal(Object.hasOwn(notSetNull, 'updatedDateState'), false);
  for (const publicationStatus of ['draft', 'hidden', 'published']) {
    const missing: Record<string, unknown> = { ...article.data, publicationStatus };
    delete missing.updatedDate;
    const data = cmsArticleStorageSchema.parse(missing);
    assert.equal(Object.hasOwn(data, 'updatedDate'), false);
    assert.equal(articleReadySchema.safeParse(data).success, false);
    const notSet = cmsArticleStorageSchema.parse({ ...missing, updatedDateState: 'not-set' });
    assert.equal(Object.hasOwn(notSet, 'updatedDate'), false);
    assert.equal(Object.hasOwn(notSet, 'updatedDateState'), false);
    assert.equal(notSet.publicationStatus, publicationStatus);
    assert.equal(articleReadySchema.safeParse(notSet).success, false);
    for (const value of [undefined, null]) {
      const input = { ...missing, ...(value === null ? { updatedDate: null } : {}) };
      assert.equal(cmsArticleStorageSchema.safeParse({ ...input, updatedDateState: 'known' }).success, false);
      const unknown = cmsArticleStorageSchema.parse({ ...input, updatedDateState: 'unknown' });
      assert.equal(unknown.updatedDate, null);
      assert.equal(unknown.publicationStatus, publicationStatus);
      assert.equal(articleReadySchema.safeParse(unknown).success, publicationStatus === 'published');
    }
  }
});

test('CMS dates reject empty/invalid values and Unknown conflicts, including empty strings', () => {
  for (const updatedDate of ['', ' ', 'null', '2026-02-29', '2026-04-31', '2026-1-01', '2026-01-01T00:00:00Z', 0, false, {}, []]) {
    for (const state of [undefined, 'known', 'unknown', 'not-set']) {
      assert.equal(cmsArticleStorageSchema.safeParse({ ...article.data, updatedDate, ...(state ? { updatedDateState: state } : {}) }).success, false);
    }
  }
  assert.equal(cmsArticleStorageSchema.safeParse({ ...article.data, updatedDate: '2024-02-29', updatedDateState: 'unknown' }).success, false);
  for (const updatedDateState of ['', 'Unknown', null, false]) {
    assert.equal(cmsArticleStorageSchema.safeParse({ ...article.data, updatedDateState }).success, false);
  }
});

test('YAML staging parser uses the same CMS adapter as Content Collections', () => {
  const data = { ...article.data, updatedDateState: 'unknown' };
  delete (data as Partial<typeof data>).updatedDate;
  const source = `---\n${JSON.stringify(data)}\n---\n${article.body}`;
  assert.deepEqual(parseArticle(source).data, cmsArticleStorageSchema.parse(data));
  assert.equal(parseArticle(source).body, article.body);
  assert.throws(() => parseArticle(source.replace('"unknown"', '"known"')), /updatedDate.*Known/);
});

test('shared raw article parser preserves quoted/unquoted dates and rejects rollover without Date coercion', () => {
  for (const literal of ['2024-02-29', '"2024-02-29"']) {
    for (const state of ['known', 'not-set']) {
      const source = `---\nslug: verified-date\nupdatedDateState: ${state}\nupdatedDate: ${literal}\n---\nBody`;
      const raw = parseCmsArticleSource(source);
      assert.equal(raw.data.updatedDate, '2024-02-29');
      assert.equal(raw.body, 'Body');
      assert.equal(parseArticle(source).data.updatedDate, '2024-02-29');
    }
  }
  for (const literal of ['2026-02-29', '2026-04-31', '"2026-02-29"', '2024-02-29T00:00:00Z', '""']) {
    assert.throws(() => parseArticle(`---\nslug: invalid-date\nupdatedDate: ${literal}\n---\nBody`), /calendar date|Invalid string|Invalid input/);
  }
  assert.equal(cmsArticleStorageSchema.safeParse({ ...article.data, updatedDate: new Date('2024-02-29T00:00:00Z') }).success, false);
  for (const source of ['No frontmatter', '---\nnull\n---\nBody', '---\n- item\n---\nBody']) assert.throws(() => parseCmsArticleSource(source));
});

test('CMS states do not bypass image metadata, required display fields, or publication status', () => {
  const input = { ...property, monthlyRent: undefined, monthlyRentState: 'unknown' };
  for (const images of [[{ ...property.images[0], alt: '' }], [{ ...property.images[0], usage: undefined }]]) {
    assert.equal(cmsPropertyStorageSchema.safeParse({ ...input, images }).success, false);
  }
  const incomplete = cmsPropertyStorageSchema.parse({ ...input, images: [] });
  assert.equal(propertyReadySchema.safeParse(incomplete).success, false);
  assert.equal(cmsPropertyStorageSchema.safeParse({ ...input, publicationStatus: 'invalid' }).success, false);
  assert.equal(cmsPropertyStorageSchema.parse({ propertyId: 'minimal-cms-draft' }).publicationStatus, 'draft');
  assert.deepEqual(cmsArticleStorageSchema.parse({ slug: 'minimal-cms-draft' }), { slug: 'minimal-cms-draft', publicationStatus: 'draft' });
  assert.equal(cmsArticleStorageSchema.safeParse({ ...article.data, updatedDateState: 'unknown', coverImage: { ...article.data.coverImage, usage: undefined } }).success, false);
});

test('CMS configuration has explicit choices without invented intent or numeric/date defaults', async () => {
  const config = parseYaml(await readFile(new URL('../.pages.yml', import.meta.url), 'utf8'));
  const stateComponent = config.components['nullable-state'];
  assert.deepEqual(stateComponent.options.values.map((value: { name: string }) => value.name), ['not-set', 'known', 'unknown']);
  assert.equal(Object.hasOwn(stateComponent, 'default'), false);
  assert.equal(stateComponent.required, undefined);
  for (const [collectionName, fields] of [['properties', measurements], ['neighborhoods', ['updatedDate']]] as const) {
    const collection = config.content.find((item: { name: string }) => item.name === collectionName);
    for (const fieldName of fields) {
      const value = collection.fields.find((field: { name: string }) => field.name === fieldName);
      const state = collection.fields.find((field: { name: string }) => field.name === `${fieldName}State`);
      assert.equal(state.component, 'nullable-state');
      assert.equal(Object.hasOwn(state, 'default'), false);
      assert.equal(state.required, undefined);
      assert.equal(value.required, undefined, 'Required numbers must not coerce blank into zero');
      assert.equal(Object.hasOwn(value, 'default'), fieldName === 'updatedDate');
      if (fieldName === 'updatedDate') assert.equal(value.default, '');
    }
  }
});

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
  assert.equal(propertyReadySchema.parse({ ...studio, monthlyRent: null }).monthlyRent, null);
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

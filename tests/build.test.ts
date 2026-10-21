import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile, mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { root, runAstro, outputAudit, publishedImages, hash } from './helpers.ts';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

test('production build, validation failures, publication changes, and actual dist privacy', { timeout: 600_000 }, async (t) => {
  const propertyFile = resolve(root, 'src/content/properties/published-property.json');
  const studioFile = resolve(root, 'src/content/properties/published-studio.json');
  const draftFile = resolve(root, 'src/content/properties/draft-property.json');
  const articleFile = resolve(root, 'src/content/neighborhoods/published-guide.md');
  const hiddenFile = resolve(root, 'src/content/properties/hidden-property.json');
  const draftArticleFile = resolve(root, 'src/content/neighborhoods/draft-guide.md');
  const hiddenArticleFile = resolve(root, 'src/content/neighborhoods/hidden-guide.md');
  const originals = new Map<string, string>();
  for (const file of [propertyFile, studioFile, draftFile, articleFile, hiddenFile, draftArticleFile, hiddenArticleFile]) originals.set(file, await readFile(file, 'utf8'));
  const property = JSON.parse(originals.get(propertyFile)!);
  const measurements = ['monthlyRent', 'bedrooms', 'bathrooms', 'squareFeet'] as const;
  const articleMatch = originals.get(articleFile)!.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/)!;
  const articleData = parseYaml(articleMatch[1]);
  // Keep legacy-object coverage explicit after the stored fixtures are migrated.
  const legacyCoverImage = Array.isArray(articleData.coverImage) ? articleData.coverImage[0] : articleData.coverImage;
  const articleWith = (updatedDateState: string | undefined, updatedDate: unknown) => {
    const data = { ...articleData, updatedDateState, updatedDate };
    if (updatedDate === undefined) delete data.updatedDate;
    if (updatedDateState === undefined) delete data.updatedDateState;
    return `---\n${stringifyYaml(data)}---\n${articleMatch[2]}`;
  };
  const articleWithCover = (coverImage: unknown) => {
    const data = { ...articleData, coverImage };
    if (coverImage === undefined) delete data.coverImage;
    return `---\n${stringifyYaml(data)}---\n${articleMatch[2]}`;
  };
  const draftMatch = originals.get(draftArticleFile)!.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/)!;
  const draftData = parseYaml(draftMatch[1]);
  const draftCover = { ...legacyCoverImage, src: 'src/assets/uploads/draft-guide.png', alt: 'Draft-only synthetic image representing an unfinished imaginary guide' };
  const draftWithCover = (coverImage: unknown) => {
    const data = { ...draftData, ...(coverImage === undefined ? {} : { coverImage }) };
    return `---\n${stringifyYaml(data)}---\n${draftMatch[2]}`;
  };
  let baselineHtml = '';
  const report: Record<string, unknown> = { purpose: 'Synthetic local POC; no deployment', scenarios: [] };
  const scenarios = report.scenarios as { name: string; passed: boolean; detail?: string }[];
  const scenario = async (name: string, action: () => Promise<void>) => {
    await t.test(name, async () => {
      try { await action(); scenarios.push({ name, passed: true }); }
      catch (error) { scenarios.push({ name, passed: false, detail: String(error) }); throw error; }
    });
  };
  const restore = async () => { for (const [file, content] of originals) await writeFile(file, content); };
  const build = async () => {
    const result = await runAstro('build');
    assert.equal(result.code, 0, result.output);
  };
  const invalidBuild = async (name: string, file: string, content: string, message: RegExp) => {
    await scenario(name, async () => {
      try {
        await writeFile(file, content);
        const result = await runAstro('build');
        assert.notEqual(result.code, 0, 'Invalid content must fail the candidate build');
        assert.match(result.output, message);
        await assert.rejects(access(resolve(root, 'dist/index.html')), 'No stale successful artifact after a failed candidate');
        report[`rejection:${name}`] = result.output;
      } finally { await restore(); }
    });
  };

  try {
    await scenario('Astro TypeScript and schema diagnostics', async () => {
      const result = await runAstro('check');
      assert.equal(result.code, 0, result.output);
      assert.match(result.output, /0 errors/);
      report.typecheck = result.output;
    });
    await scenario('fresh production build and baseline dist audit', async () => {
      await build();
      const audit = await outputAudit();
      baselineHtml = audit.html;
      report.baseline = { ...audit, html: undefined };
      assert.match(audit.html, /Fictional Maple Flat/);
      assert.match(audit.html, /Fictional Pixel Studio/);
      assert.match(audit.html, /Fictional Lantern Quarter Guide/);
      const studio = audit.html.match(/<article data-property-id="fictional-pixel-studio"[\s\S]*?<\/article>/)?.[0];
      assert.ok(studio);
      assert.match(studio, /Studio/);
      assert.match(studio, /\$0 \/ month/); // Hosted Save now records actual zero rent.
      assert.match(studio, /Coming Soon/);
      assert.match(studio, /Area not specified/);
      assert.match(audit.html, /1\.5 bathrooms/);
      assert.match(audit.html, /\$1,250 \/ month/);
      assert.match(audit.html, /<h2[^>]*>A fictional walk<\/h2>/);
      assert.match(audit.html, /<strong>synthetic editorial content<\/strong>/);
      assert.match(audit.html, /<li>Imagine a small square made of colored tiles\.<\/li>/);
      assert.match(audit.html, /href="https:\/\/example\.invalid\/planning-reference"[^>]*>Fictional planning reference \(test citation\)<\/a>/);
      assert.match(audit.html, /href="https:\/\/example\.invalid\/walking-reference"/);
      assert.equal(audit.html.includes('<time'), false, 'No invented date');
      assert.match(audit.html, /alt="Synthetic green and blue blocks representing Fictional Maple Flat"/);
      assert.match(audit.html, /alt="Synthetic colorful stripes representing Fictional Pixel Studio"/);
      assert.match(audit.html, /alt="Synthetic bands of color illustrating the imaginary Lantern Quarter"/);
      assert.equal(audit.html.includes('data-fallback="coming-soon"'), false);
    });
    await scenario('dist scanner rejects renamed draft original and transformed image bytes', async () => {
      const original = resolve(root, 'dist/_media/unrelated-name.bin');
      await copyFile(resolve(root, 'src/assets/uploads/draft-guide.png'), original);
      await assert.rejects(outputAudit(), /Forbidden original\/transformed bytes/);
      // Reuse the production transform but rename it to prove extension independence.
      const sharp = (await import('sharp')).default;
      await sharp(resolve(root, 'src/assets/uploads/draft-guide.png')).resize({ width: 640, withoutEnlargement: true }).webp({ quality: 80 }).toFile(original);
      await assert.rejects(outputAudit(), /Forbidden original\/transformed bytes/);
      await build();
      await outputAudit();
    });
    await scenario('missing status defaults to Draft in real build and excludes its image', async () => {
      try {
        const draft = JSON.parse(originals.get(draftFile)!); delete draft.publicationStatus;
        await writeFile(draftFile, JSON.stringify(draft, null, 2));
        await build(); await outputAudit();
      } finally { await restore(); }
    });
    await scenario('published unavailable property stays visible independently of publication status', async () => {
      try {
        await writeFile(propertyFile, JSON.stringify({ ...property, availability: 'unavailable' }));
        await build(); const { html } = await outputAudit();
        assert.match(html, /Unavailable/); assert.match(html, /Fictional Maple Flat/);
      } finally { await restore(); }
    });

    await scenario('CMS one-item cover list produces the same HTML and assets as the legacy object', async () => {
      try {
        await writeFile(articleFile, articleWithCover(legacyCoverImage));
        await build();
        const legacy = await outputAudit();
        assert.equal(legacy.html, baselineHtml);
        await writeFile(articleFile, articleWithCover([legacyCoverImage]));
        await build();
        const audit = await outputAudit();
        assert.equal(audit.html, legacy.html, 'Body, citations, dates, status and image rendering stay identical');
        assert.deepEqual(audit.inventory, legacy.inventory);
        report.coverList = { sameLegacyHtml: true, inventory: audit.inventory };
      } finally { await restore(); }
    });

    for (const coverImage of [[], undefined]) {
      await scenario(`CMS ${coverImage === undefined ? 'omitted' : 'empty-list'} cover removes otherwise unused originals and transforms`, async () => {
        try {
          await build();
          await outputAudit(); // The old cover assets exist before removal.
          await writeFile(articleFile, articleWithCover(coverImage));
          await build();
          const audit = await outputAudit(['published-property', 'published-studio'], ['published-guide']);
          const guideWithoutFigure = (html: string) => html.match(/<article id="fictional-lantern-quarter"[\s\S]*?<\/article>/)![0]
            .replace(/<figure\b[\s\S]*?<\/figure>/g, '').replace(/\s+/g, ' ');
          assert.equal(guideWithoutFigure(audit.html), guideWithoutFigure(baselineHtml));
          assert.equal(audit.inventory.filter(file => file.image).length, 4);
          report[`coverRemoved:${coverImage === undefined ? 'omitted' : 'empty-list'}`] = { inventory: audit.inventory, otherArticleContentUnchanged: true };
        } finally { await restore(); }
      });
    }

    await scenario('removed article cover remains staged when another Published record still uses it', async () => {
      try {
        await writeFile(articleFile, articleWithCover([]));
        await writeFile(propertyFile, JSON.stringify({ ...property, images: [...property.images, legacyCoverImage] }));
        await build();
        await outputAudit();
      } finally { await restore(); }
    });

    await scenario('Draft without a cover and Hidden with a cover do not publish their text or image bytes', async () => {
      try {
        for (const file of [draftArticleFile, hiddenArticleFile]) {
          const source = originals.get(file)!;
          const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/)!;
          const data = parseYaml(match[1]);
          if (Object.hasOwn(data, 'coverImage')) {
            assert.equal(file, hiddenArticleFile);
            assert.equal(data.publicationStatus, 'hidden');
            assert.ok(Array.isArray(data.coverImage));
            assert.equal(data.coverImage.length, 1);
          } else {
            assert.equal(file, draftArticleFile);
            assert.equal(data.publicationStatus, 'draft');
          }
        }
        await build();
        const audit = await outputAudit();
        assert.equal(audit.html, baselineHtml);
      } finally { await restore(); }
    });

    await scenario('Draft with a complete one-item cover remains private with its original and transformed assets excluded', async () => {
      try {
        await writeFile(draftArticleFile, draftWithCover([draftCover]));
        await build();
        const audit = await outputAudit();
        assert.equal(audit.html, baselineHtml);
      } finally { await restore(); }
    });

    // YAML serializes undefined array items as null; the raw [undefined] input
    // is also rejected directly by the existing CMS schema unit tests.
    for (const [name, coverImage, message] of [
      ['null item', [null], /coverImage/],
      ['undefined item serialized as null', [undefined], /coverImage/],
      ['partial image', [{ src: draftCover.src }], /coverImage/],
      ['missing authorization', [{ ...draftCover, usage: undefined }], /usage/],
      ['invalid authorization', [{ ...draftCover, usage: { ...draftCover.usage, authorization: 'unknown' } }], /authorization/],
    ] as const) {
      await invalidBuild(`Draft cover list rejects ${name}`, draftArticleFile, draftWithCover(coverImage), message);
    }

    for (const [name, coverImage, message] of [
      ['multiple covers', [legacyCoverImage, legacyCoverImage], /coverImage/],
      ['missing image path', [{ ...legacyCoverImage, src: undefined }], /coverImage/],
      ['missing alt text', [{ ...legacyCoverImage, alt: '' }], /alt/],
      ['missing authorization', [{ ...legacyCoverImage, usage: undefined }], /usage/],
      ['invalid image path', [{ ...legacyCoverImage, src: 'https://example.invalid/cover.png' }], /src/],
      ['missing local image', [{ ...legacyCoverImage, src: 'src/assets/uploads/missing.png' }], /missing\.png/],
    ] as const) {
      await invalidBuild(`CMS cover list rejects ${name}`, articleFile, articleWithCover(coverImage), message);
    }
    await invalidBuild('empty cover list cannot bypass Markdown security', articleFile, articleWithCover([]) + '\n[unsafe](javascript:alert(1))\n', /Unsafe Markdown link/);

    for (const state of ['unknown', 'not-set']) {
      await scenario(`CMS ${state}: Unknown omissions normalize to null; Not Set preserves explicit null`, async () => {
        try {
          const data = { ...property };
          for (const field of measurements) {
            if (state === 'unknown') delete data[field]; else data[field] = null;
            data[`${field}State`] = state;
          }
          await writeFile(propertyFile, JSON.stringify(data));
          await writeFile(articleFile, articleWith(state, state === 'unknown' ? undefined : null));
          await build();
          const audit = await outputAudit();
          const flat = audit.html.match(/<article data-property-id="fictional-maple-flat"[\s\S]*?<\/article>/)?.[0];
          assert.ok(flat);
          for (const expected of ['Contact for pricing', 'Bedrooms not specified', 'Bathrooms not specified', 'Area not specified']) assert.ok(flat.includes(expected), expected);
          assert.doesNotMatch(audit.html, /<time\b/);
          assert.doesNotMatch(audit.html, /(?:monthlyRent|bedrooms|bathrooms|squareFeet|updatedDate)State/);
          report[`cmsNull:${state}`] = { canonicalNullRendering: true, noInventedDate: true, images: audit.inventory.filter((file) => file.image).map((file) => file.path) };
        } finally { await restore(); }
      });
    }

    for (const state of ['known', 'not-set']) {
      await scenario(`CMS ${state}: zero, decimal bathrooms and a verified date survive the complete build`, async () => {
        try {
          const data = { ...property, monthlyRent: 0, bedrooms: 0, bathrooms: 1.5, squareFeet: 0 };
          for (const field of measurements) data[`${field}State`] = state;
          await writeFile(propertyFile, JSON.stringify(data));
          await writeFile(articleFile, articleWith(state, '2024-02-29'));
          await build();
          const { html } = await outputAudit();
          const flat = html.match(/<article data-property-id="fictional-maple-flat"[\s\S]*?<\/article>/)?.[0];
          assert.ok(flat);
          assert.match(flat, /\$0 \/ month/);
          assert.match(flat, /Studio/);
          assert.match(flat, /1\.5 bathrooms/);
          assert.match(flat, /0 sq ft/);
          assert.match(html, /<time\b[^>]*\bdatetime="2024-02-29"[^>]*>2024-02-29<\/time>/);
          assert.doesNotMatch(html, /(?:monthlyRent|bedrooms|bathrooms|squareFeet|updatedDate)State/);
          report[`cmsValues:${state}`] = { zeroRent: true, studioZero: true, decimalBathrooms: true, zeroArea: true, verifiedDate: '2024-02-29' };
        } finally { await restore(); }
      });
    }

    await scenario('legacy verified dates work without state fields', async () => {
      try {
        // Replace parsed fields: hosted Save omitted the old updatedDate: null line.
        await writeFile(articleFile, articleWith(undefined, '2024-02-29'));
        await build();
        const { html } = await outputAudit();
        assert.match(html, /<time\b[^>]*\bdatetime="2024-02-29"[^>]*>2024-02-29<\/time>/);
      } finally { await restore(); }
    });

    for (const state of ['unknown', 'not-set']) {
      await scenario(`CMS ${state} states never publish Draft or Hidden records or their assets`, async () => {
        try {
          for (const file of [draftFile, hiddenFile]) {
            const data = JSON.parse(originals.get(file)!);
            for (const field of measurements) data[`${field}State`] = state;
            await writeFile(file, JSON.stringify(data));
          }
          for (const file of [draftArticleFile, hiddenArticleFile]) {
            await writeFile(file, originals.get(file)!.replace('title:', `updatedDateState: ${state}\ntitle:`));
          }
          await build();
          await outputAudit();
        } finally { await restore(); }
      });
    }

    for (const field of measurements) {
      const missing = { ...property }; delete missing[field];
      await invalidBuild(`CMS Published ${field} missing without Unknown fails candidate`, propertyFile, JSON.stringify(missing), new RegExp(field));
      await invalidBuild(`CMS Published ${field} missing with Not Set fails candidate`, propertyFile, JSON.stringify({ ...missing, [`${field}State`]: 'not-set' }), new RegExp(field));
      await invalidBuild(`CMS ${field} Known without a value fails candidate`, propertyFile, JSON.stringify({ ...missing, [`${field}State`]: 'known' }), new RegExp(`${field}.*Known`));
      await invalidBuild(`CMS ${field} Unknown conflicts with numeric zero`, propertyFile, JSON.stringify({ ...property, [field]: 0, [`${field}State`]: 'unknown' }), new RegExp(`${field}.*Unknown`));
    }
    await invalidBuild('CMS Known rent cannot use legacy null', propertyFile, JSON.stringify({ ...property, monthlyRent: null, monthlyRentState: 'known' }), /monthlyRent.*Known/);
    await invalidBuild('CMS invalid numeric state fails candidate', propertyFile, JSON.stringify({ ...property, monthlyRentState: 'Unknown' }), /monthlyRentState.*known or unknown/);
    await invalidBuild('CMS Known rent rejects numeric strings', propertyFile, JSON.stringify({ ...property, monthlyRent: '0', monthlyRentState: 'known' }), /monthlyRent/);
    await invalidBuild('CMS Known bedrooms reject fractional values', propertyFile, JSON.stringify({ ...property, bedrooms: 0.5, bedroomsState: 'known' }), /bedrooms/);
    await invalidBuild('CMS Published date missing without Unknown fails candidate', articleFile, articleWith(undefined, undefined), /updatedDate/);
    await invalidBuild('CMS Published date missing with Not Set fails candidate', articleFile, articleWith('not-set', undefined), /updatedDate/);
    await invalidBuild('CMS Known date missing fails candidate', articleFile, articleWith('known', undefined), /updatedDate.*Known/);
    await invalidBuild('CMS Known date cannot use legacy null', articleFile, articleWith('known', null), /updatedDate.*Known/);
    await invalidBuild('CMS Unknown date conflicts with a supplied date', articleFile, articleWith('unknown', '2024-02-29'), /updatedDate.*Unknown/);
    await invalidBuild('CMS Known date rejects an empty string', articleFile, articleWith('known', ''), /updatedDate/);
    await invalidBuild('CMS Unknown date rejects an empty string', articleFile, articleWith('unknown', ''), /updatedDate.*Unknown/);
    await invalidBuild('CMS Known date rejects an invalid calendar date', articleFile, articleWith('known', '2026-02-29'), /calendar date/);
    await invalidBuild('CMS raw unquoted rollover date fails candidate', articleFile, articleWith('known', '2026-02-29'), /calendar date/);

    const unknownRent = { ...property, monthlyRentState: 'unknown' }; delete unknownRent.monthlyRent;
    await invalidBuild('CMS Unknown does not bypass image authorization', propertyFile, JSON.stringify({ ...unknownRent, images: [{ ...property.images[0], usage: undefined }] }), /usage/);
    await invalidBuild('CMS Unknown does not bypass Markdown security', articleFile, articleWith('unknown', undefined) + '\n[unsafe](javascript:alert(1))\n', /Unsafe Markdown link/);

    await invalidBuild('unknown publication state fails build', propertyFile, JSON.stringify({ ...property, publicationStatus: 'invalid' }), /publicationStatus/);
    await invalidBuild('negative rent fails build', propertyFile, JSON.stringify({ ...property, monthlyRent: -1 }), /monthlyRent/);
    await invalidBuild('empty rent cannot become zero', propertyFile, JSON.stringify({ ...property, monthlyRent: '' }), /monthlyRent/);
    await invalidBuild('invalid calendar date fails build', articleFile, articleWith(undefined, '2026-02-29'), /calendar date/);
    const incomplete = { ...property }; delete incomplete.location;
    await invalidBuild('published property missing display metadata fails build', propertyFile, JSON.stringify(incomplete), /location/);
    await invalidBuild('published article missing sources fails build', articleFile, originals.get(articleFile)!.replace(/sources:[\s\S]*?coverImage:/, 'sources: []\ncoverImage:'), /sources/);
    await invalidBuild('published article missing body fails build', articleFile, `---\n${articleMatch[1]}\n---\n`, /Markdown body/);
    await invalidBuild('escaping image path fails build', propertyFile, JSON.stringify({ ...property, images: [{ ...property.images[0], src: 'src/assets/uploads/../secret.png' }] }), /src/);
    await invalidBuild('missing image alt fails build', propertyFile, JSON.stringify({ ...property, images: [{ ...property.images[0], alt: '' }] }), /alt/);
    await invalidBuild('missing image authorization fails build', propertyFile, JSON.stringify({ ...property, images: [{ ...property.images[0], usage: undefined }] }), /usage/);
    await invalidBuild('duplicate stable property ID fails build', studioFile, JSON.stringify({ ...JSON.parse(originals.get(studioFile)!), propertyId: property.propertyId }), /Duplicate property ID/);
    await invalidBuild('Markdown inline images cannot bypass the media boundary', articleFile, originals.get(articleFile)! + '\n![bypass](../assets/uploads/draft-guide.png)\n', /structured coverImage/);

    for (const [name, markdown] of [
      ['inline JavaScript', '[unsafe](javascript:alert(1))'],
      ['reference JavaScript', '[unsafe][security-link]\n\n[security-link]: javascript:alert(1)'],
      ['collapsed reference JavaScript', '[security-link][]\n\n[security-link]: javascript:alert(1)'],
      ['shortcut reference JavaScript', '[security-link]\n\n[security-link]: javascript:alert(1)'],
      ['data protocol', '[unsafe](data:text/html,unsafe)'],
      ['VBScript protocol', '[unsafe](vbscript:msgbox(1))'],
      ['mixed-case protocol', '[unsafe](JaVaScRiPt:alert(1))'],
      ['entity-obfuscated reference', '[unsafe][security-link]\n\n[security-link]: jav&#x61;script&colon;alert(1)'],
      ['control-obfuscated protocol', '[unsafe](java&#x09;script:alert(1))'],
      ['whitespace-obfuscated protocol', '[unsafe](< javascript:alert(1)>)'],
      ['percent-encoded protocol', '[unsafe](javascript%3Aalert(1))'],
      ['protocol-relative destination', '[unsafe](//example.invalid)'],
      ['encoded protocol-relative destination', '[unsafe](/%252fexample.invalid)'],
      ['unsafe autolink', '<javascript:alert(1)>'],
    ]) {
      await invalidBuild(`unsafe Markdown ${name} fails candidate build`, articleFile, originals.get(articleFile)! + `\n${markdown}\n`, /Unsafe Markdown link/);
    }

    await scenario('safe Markdown links and literal attack examples are verified in final generated HTML', async () => {
      try {
        await writeFile(articleFile, originals.get(articleFile)! + '\n## Link security examples\n\n[secure](https://example.invalid/safe) [site](/properties) [fragment](#a-fictional-walk) [reference][security-safe] [collapsed][] [shortcut]\n\n[security-safe]: https://example.invalid/reference\n[collapsed]: /guides\n[shortcut]: #a-fictional-walk\n\n`[literal](javascript:alert(1))`\n\n```text\n[reference][unsafe]\n\n[unsafe]: data:text/html,unsafe\n![literal](/x.png)\n<script>alert(1)</script>\n```\n');
        await build();
        const { html } = await outputAudit();
        const hrefs = [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((match) => match[1]);
        assert.deepEqual(hrefs, [
          'https://example.invalid/safe', '/properties', '#a-fictional-walk',
          'https://example.invalid/reference', '/guides', '#a-fictional-walk',
          'https://example.invalid/planning-reference', 'https://example.invalid/walking-reference',
        ]);
        assert.match(html, /<code>\[literal\]\(javascript:alert\(1\)\)<\/code>/);
        assert.match(html, /&lt;script&gt;/);
        assert.match(html, /<h2[^>]*>Link security examples<\/h2>/);
        assert.doesNotMatch(html, /<script\b/i);
        assert.equal((html.match(/<img\b/g) ?? []).length, 3, 'Only structured published images render');
        report.markdownSecurity = { hrefs, unsafeCandidateCases: 14, literalCodeVerified: true };
      } finally { await restore(); }
    });

    await scenario('Coming Soon fallback when no Published property remains', async () => {
      try {
        for (const file of [propertyFile, studioFile]) {
          await writeFile(file, JSON.stringify({ ...JSON.parse(originals.get(file)!), publicationStatus: 'hidden' }));
        }
        await build();
        const audit = await outputAudit(['published-guide'], ['published-property', 'published-studio'], ['Fictional Maple Flat', 'Fictional Pixel Studio']);
        assert.match(audit.html, /data-fallback="coming-soon"/);
        assert.match(audit.html, /Coming Soon — new fictional listings/);
        report.comingSoon = { ...audit, html: undefined };
      } finally { await restore(); }
    });
    await scenario('Published-to-Hidden property and article transition removes old media after rebuild', async () => {
      try {
        await build();
        const before = await outputAudit();
        await writeFile(propertyFile, JSON.stringify({ ...property, publicationStatus: 'hidden' }));
        await writeFile(articleFile, originals.get(articleFile)!.replace('publicationStatus: published', 'publicationStatus: hidden'));
        // These previously public files exist before rebuilding, so this checks stale output too.
        assert.equal(before.inventory.filter((file) => file.image).length, 6);
        await build();
        const after = await outputAudit(['published-studio'], ['published-property', 'published-guide'], ['Fictional Maple Flat', 'Fictional Lantern Quarter Guide', 'synthetic editorial content']);
        assert.equal(after.inventory.filter((file) => file.image).length, 2);
        report.hiddenTransition = { before: before.inventory, after: after.inventory, removed: ['published-property.png', 'published-property.webp', 'published-guide.png', 'published-guide.webp'] };
      } finally { await restore(); }
    });
  } finally {
    await restore();
    await scenario('fixtures restored and final fresh build passes the full dist audit', async () => {
      await build();
      const final = await outputAudit(publishedImages);
      report.final = { ...final, html: undefined };
      for (const [file, original] of originals) assert.equal(await readFile(file, 'utf8'), original);
      report.restoredFixtureHashes = Object.fromEntries([...originals].map(([file, original]) => [file.slice(root.length).replaceAll('\\', '/'), hash(Buffer.from(original))]));
    });
    await mkdir(resolve(root, 'reports'), { recursive: true });
    report.passed = scenarios.every((result) => result.passed);
    report.passedScenarios = scenarios.filter((result) => result.passed).length;
    await writeFile(resolve(root, 'reports/test-results.json'), JSON.stringify(report, null, 2) + '\n');
    assert.equal(report.passed, true, 'See reports/test-results.json for failed scenarios');
  }
});

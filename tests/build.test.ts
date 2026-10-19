import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile, mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { root, runAstro, outputAudit, publishedImages, hash } from './helpers.ts';

test('production build, validation failures, publication changes, and actual dist privacy', { timeout: 300_000 }, async (t) => {
  const propertyFile = resolve(root, 'src/content/properties/published-property.json');
  const studioFile = resolve(root, 'src/content/properties/published-studio.json');
  const draftFile = resolve(root, 'src/content/properties/draft-property.json');
  const articleFile = resolve(root, 'src/content/neighborhoods/published-guide.md');
  const originals = new Map<string, string>();
  for (const file of [propertyFile, studioFile, draftFile, articleFile]) originals.set(file, await readFile(file, 'utf8'));
  const property = JSON.parse(originals.get(propertyFile)!);
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
      report.baseline = { ...audit, html: undefined };
      assert.match(audit.html, /Fictional Maple Flat/);
      assert.match(audit.html, /Fictional Pixel Studio/);
      assert.match(audit.html, /Fictional Lantern Quarter Guide/);
      const studio = audit.html.match(/<article data-property-id="fictional-pixel-studio"[\s\S]*?<\/article>/)?.[0];
      assert.ok(studio);
      assert.match(studio, /Studio/);
      assert.match(studio, /Contact for pricing/);
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

    await invalidBuild('unknown publication state fails build', propertyFile, JSON.stringify({ ...property, publicationStatus: 'invalid' }), /publicationStatus/);
    await invalidBuild('negative rent fails build', propertyFile, JSON.stringify({ ...property, monthlyRent: -1 }), /monthlyRent/);
    await invalidBuild('empty rent cannot become zero', propertyFile, JSON.stringify({ ...property, monthlyRent: '' }), /monthlyRent/);
    await invalidBuild('invalid calendar date fails build', articleFile, originals.get(articleFile)!.replace('updatedDate: null', 'updatedDate: "2026-02-29"'), /calendar date/);
    const incomplete = { ...property }; delete incomplete.location;
    await invalidBuild('published property missing display metadata fails build', propertyFile, JSON.stringify(incomplete), /location/);
    await invalidBuild('published article missing sources fails build', articleFile, originals.get(articleFile)!.replace(/sources:[\s\S]*?coverImage:/, 'sources: []\ncoverImage:'), /sources/);
    await invalidBuild('published article missing body fails build', articleFile, originals.get(articleFile)!.split('\n---\n')[0] + '\n---\n', /Markdown body/);
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

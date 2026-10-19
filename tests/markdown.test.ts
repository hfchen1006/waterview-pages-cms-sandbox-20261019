import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeMarkdownUrl, markdownProcessor, validateMarkdown } from '../src/lib/content/markdown-security.ts';

// Exercise the same processor factory Astro configures, in addition to staging.
const renderer = await markdownProcessor.createRenderer({});
async function rejectsMarkdown(body: string, message = /Unsafe Markdown link/) {
  await assert.rejects(validateMarkdown(body), message, JSON.stringify(body));
  await assert.rejects(renderer.render(body), message, JSON.stringify(body));
}

test('HTTPS inline, reference and autolinks retain safe destinations and formatting', async () => {
  const body = '# Safe heading\n\n**Strong** and *emphasis*.\n\n- [inline](https://example.invalid/a?q=1&x=2)\n- [reference][safe]\n- <https://example.invalid/auto>\n\n[safe]: HTTPS://example.invalid/reference';
  await validateMarkdown(body);
  const { code } = await renderer.render(body);
  assert.match(code, /<h1[^>]*>Safe heading<\/h1>/);
  assert.match(code, /<strong>Strong<\/strong>/);
  assert.match(code, /<em>emphasis<\/em>/);
  assert.match(code, /<ul>/);
  assert.match(code, /href="https:\/\/example\.invalid\/a\?q=1&amp;x=2"/);
  assert.match(code, /href="HTTPS:\/\/example\.invalid\/reference"/);
  assert.match(code, /href="https:\/\/example\.invalid\/auto"/);
});

test('single-slash paths and fragments support inline, full, collapsed and shortcut references', async () => {
  const body = '[path](/guides/caf%C3%A9?view=map#walk) [fragment](#walk) [full][route] [collapsed][] [shortcut]\n\n[route]: /properties\n[collapsed]: #walk\n[shortcut]: /';
  await validateMarkdown(body);
  const { code } = await renderer.render(body);
  for (const href of ['/guides/caf%C3%A9?view=map#walk', '#walk', '/properties', '/']) {
    assert.ok(code.includes(`href="${href}"`), href);
  }
  assert.equal((code.match(/<a /g) ?? []).length, 5);
});

test('unapproved schemes fail for inline and every reference link syntax', async () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,unsafe', 'vbscript:msgbox(1)', 'JaVaScRiPt:alert(1)', 'DaTa:text/html,unsafe', 'VbScRiPt:msgbox(1)', 'http://example.invalid', 'mailto:test@example.invalid', 'tel:123', 'file:///private', 'ftp://example.invalid']) {
    for (const body of [`[test](${url})`, `[test][ref]\n\n[ref]: ${url}`, `[ref][]\n\n[ref]: ${url}`, `[ref]\n\n[ref]: ${url}`]) {
      await rejectsMarkdown(body);
    }
  }
  await rejectsMarkdown('<javascript:alert(1)>');
});

test('entities, controls, whitespace and percent encoding cannot disguise unsafe links', async () => {
  const urls = [
    'jav&#x61;script:alert(1)', 'javascript&colon;alert(1)', '&#106;avascript:alert(1)',
    'java&#x09;script:alert(1)', 'java&#10;script:alert(1)', '&#32;javascript:alert(1)',
    'javascript%3Aalert(1)', '%6aavascript:alert(1)', 'java%09script:alert(1)',
    '/%2fexample.invalid', '/%252fexample.invalid', '/%5cexample.invalid',
    '/%255cexample.invalid', '/safe%0a//example.invalid', '/safe%2509path',
    '//example.invalid', 'https://user:pass@example.invalid', 'https:/example.invalid',
    'relative/path', '?query=only',
  ];
  for (const url of urls) {
    await rejectsMarkdown(`[test](${url})`);
    await rejectsMarkdown(`[test][ref]\n\n[ref]: ${url}`);
  }
  for (const url of [' javascript:alert(1)', 'java\tscript:alert(1)', '/\\example.invalid', '/safe\u0001path', '/safe\u200bpath']) {
    await rejectsMarkdown(`[test](<${url}>)`);
  }
});

test('URL validation rejects malformed escapes, excessive nesting and encoded path escapes', () => {
  for (const url of ['/bad%escape', '/%ff', '/%25252525252fexample.invalid', '/%2fexample.invalid', '/\\example.invalid', 'https://example.invalid/\tpath']) {
    assert.throws(() => assertSafeMarkdownUrl(url), /Unsafe Markdown link/);
  }
  for (const url of ['https://example.invalid', '/safe', '#walk', '/caf%C3%A9']) {
    assert.doesNotThrow(() => assertSafeMarkdownUrl(url));
  }
});

test('actual HTML and inline/reference images remain forbidden in the production processor', async () => {
  for (const body of ['<script>alert(1)</script>', '<a href="https://example.invalid">link</a>', '<img src="/x.png">', '<!-- raw comment -->', '![image](/x.png)', '![image][ref]\n\n[ref]: /x.png']) {
    await rejectsMarkdown(body, /structured coverImage/);
  }
});

test('inline, fenced and indented code examples stay literal and produce no links or media', async () => {
  const body = '`[example](javascript:alert(1))` and `<script>alert(1)</script>`.\n\n```text\n[reference][ref]\n\n[ref]: data:text/html,unsafe\n![example](/x.png)\n<img src="/x.png">\n```\n\n    [example](vbscript:msgbox(1))\n';
  await validateMarkdown(body);
  const { code } = await renderer.render(body);
  assert.match(code, /<code>\[example\]\(javascript:alert\(1\)\)<\/code>/);
  assert.match(code, /&lt;script&gt;/);
  assert.match(code, /<pre/);
  assert.doesNotMatch(code, /<(?:a|img|script)\b/i);
});

test('unused unsafe definitions fail closed; unresolved references remain harmless literal text', async () => {
  await rejectsMarkdown('An ordinary paragraph.\n\n[unused]: javascript:alert(1)');
  const body = '[unresolved][missing] and ![unresolved image][missing]\n\n[test](<java\nscript:alert(1)>)';
  await validateMarkdown(body);
  const { code } = await renderer.render(body);
  assert.doesNotMatch(code, /<(?:a|img)\b/);
});

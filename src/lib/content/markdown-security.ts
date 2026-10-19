import { satteri } from '@astrojs/markdown-satteri';

const linkError = 'Unsafe Markdown link: use HTTPS without credentials, a single-slash site path, or a local #fragment';
const mediaError = 'Use structured coverImage fields; Markdown images and raw HTML are disabled in this POC';
const localOrigin = 'https://markdown-validation.invalid';

function allowedDestination(value: string) {
  // Never rely on URL() trimming controls or treating backslashes as slashes.
  if (!value || /[\s\p{Cc}\p{Cf}\\]/u.test(value)) return false;
  if (value.startsWith('#')) return true;
  try {
    if (value.startsWith('/') && !value.startsWith('//')) {
      return new URL(value, localOrigin).origin === localOrigin;
    }
    if (!/^https:\/\//i.test(value)) return false;
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function assertSafeMarkdownUrl(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error(linkError);
  // Markdown has already decoded entities/escapes. Also inspect percent-decoded
  // forms so encoded controls, backslashes and // cannot disguise a destination.
  let candidate = value;
  for (let depth = 0; depth < 5; depth++) {
    if (!allowedDestination(candidate)) throw new Error(linkError);
    if (!candidate.includes('%')) return;
    try { candidate = decodeURIComponent(candidate); }
    catch { throw new Error(linkError); }
  }
  // Excessive nesting is rejected rather than guessed at or silently accepted.
  throw new Error(linkError);
}

function rejectEmbeddedMedia(): never {
  throw new Error(mediaError);
}

// These plugins run in Astro's actual Markdown processor, not a second parser.
export const markdownProcessor = satteri({
  mdastPlugins: [{
    name: 'poc-markdown-security',
    link(node) { assertSafeMarkdownUrl(node.url); },
    definition(node) { assertSafeMarkdownUrl(node.url); },
    image: rejectEmbeddedMedia,
    imageReference: rejectEmbeddedMedia,
    html: rejectEmbeddedMedia,
  }],
  hastPlugins: [{
    name: 'poc-rendered-link-security',
    raw: rejectEmbeddedMedia,
    element: {
      filter: ['a', 'img'],
      visit(node) {
        if (node.tagName === 'img') rejectEmbeddedMedia();
        assertSafeMarkdownUrl(node.properties.href);
      },
    },
  }],
});

// Reuse the production processor for early, fail-closed validation. Highlighting
// is unnecessary here; code nodes remain literal in either renderer.
let validationRenderer: ReturnType<typeof markdownProcessor.createRenderer> | undefined;
export async function validateMarkdown(body: string) {
  validationRenderer ??= markdownProcessor.createRenderer({ syntaxHighlight: false });
  await (await validationRenderer).render(body);
}

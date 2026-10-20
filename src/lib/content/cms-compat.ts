import { z } from 'astro/zod';
import { parse as parseYaml } from 'yaml';
import { propertyStorageSchema, articleStorageSchema, imageSchema } from './schemas.ts';

// CMS-only intent fields are consumed before the unchanged canonical schemas.
// Only explicit unknown intent can recover a value omitted by Pages CMS.
const propertyFields = ['monthlyRent', 'bedrooms', 'bathrooms', 'squareFeet'] as const;
const articleFields = ['updatedDate'] as const;

// Keep date-only YAML scalars as their authored strings. Astro's stock Markdown
// parser enables timestamp tags and would turn unquoted dates into Date objects,
// losing the original spelling before strict calendar validation can run.
export function parseCmsArticleSource(source: string) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error('Article requires YAML frontmatter');
  return { data: z.record(z.string(), z.unknown()).parse(parseYaml(match[1])), body: match[2] };
}

function normalizeNullableFields(input: unknown, fields: readonly string[], ctx: z.RefinementCtx): unknown {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return input;

  const data: Record<string, unknown> = { ...input };
  let invalid = false;
  for (const field of fields) {
    const stateKey = `${field}State`;
    const state = data[stateKey];
    if (state === undefined) continue; // Legacy numbers/nulls and incomplete drafts keep their existing semantics.

    if (state !== 'not-set' && state !== 'known' && state !== 'unknown') {
      ctx.addIssue({ code: 'custom', path: [stateKey], message: `${stateKey} must be not-set, known or unknown; omit it for legacy content.` });
      invalid = true;
    } else if (state === 'known' && (data[field] === undefined || data[field] === null)) {
      ctx.addIssue({ code: 'custom', path: [field], message: `${field} is marked Known but has no value. Enter a valid value or choose Unknown.` });
      invalid = true;
    } else if (state === 'unknown') {
      if (data[field] !== undefined && data[field] !== null) {
        ctx.addIssue({ code: 'custom', path: [field], message: `${field} is marked Unknown but still contains a value. Clear the value or choose Known.` });
        invalid = true;
      } else {
        data[field] = null;
      }
    }
    // Not Set removes only the marker: preserve values, explicit nulls and absence.
    delete data[stateKey];
  }
  return invalid ? z.NEVER : data;
}

const coverListSchema = z.array(imageSchema).max(1);

function normalizeArticle(input: unknown, ctx: z.RefinementCtx): unknown {
  const normalized = normalizeNullableFields(input, articleFields, ctx);
  if (normalized === null || typeof normalized !== 'object' || Array.isArray(normalized)) return normalized;

  const data = normalized as Record<string, unknown>;
  if (!Array.isArray(data.coverImage)) return data; // Preserve legacy objects and absence.

  // Validate every supplied item before unwrapping; even [undefined] must fail.
  const cover = coverListSchema.safeParse(data.coverImage);
  if (!cover.success) {
    for (const issue of cover.error.issues) {
      ctx.addIssue({ ...issue, path: ['coverImage', ...issue.path] });
    }
    return z.NEVER;
  }
  if (cover.data.length === 0) delete data.coverImage;
  else data.coverImage = cover.data[0];
  return data;
}

// Both ingestion paths use these exact schemas. Only the cover list envelope is
// normalized; canonical image validation and Markdown remain unchanged. No numeric/
// date coercion or defaults, or publication-status changes, are permitted here.
export const cmsPropertyStorageSchema = z.preprocess(
  (input, ctx) => normalizeNullableFields(input, propertyFields, ctx),
  propertyStorageSchema,
);
export const cmsArticleStorageSchema = z.preprocess(
  (input, ctx) => normalizeArticle(input, ctx),
  articleStorageSchema,
);

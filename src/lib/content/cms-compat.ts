import { z } from 'astro/zod';
import { parse as parseYaml } from 'yaml';
import { propertyStorageSchema, articleStorageSchema } from './schemas.ts';

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

    if (state !== 'known' && state !== 'unknown') {
      ctx.addIssue({ code: 'custom', path: [stateKey], message: `${stateKey} must be known or unknown; omit it for legacy content.` });
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
    delete data[stateKey];
  }
  return invalid ? z.NEVER : data;
}

// Both ingestion paths use these exact schemas. No coercion, numeric/date defaults,
// publication-status changes, or normalization of images/Markdown is permitted here.
export const cmsPropertyStorageSchema = z.preprocess(
  (input, ctx) => normalizeNullableFields(input, propertyFields, ctx),
  propertyStorageSchema,
);
export const cmsArticleStorageSchema = z.preprocess(
  (input, ctx) => normalizeNullableFields(input, articleFields, ctx),
  articleStorageSchema,
);

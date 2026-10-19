import { z } from 'astro/zod';

const text = z.string().trim().min(1);
const identifier = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
const measure = z.number().nonnegative().nullable();
export const publicationStatus = z.enum(['draft', 'published', 'hidden']).default('draft');
export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, 'Expected a real calendar date (YYYY-MM-DD)');

// A deliberately narrow local-only upload format; no URLs, traversal, nested paths, or SVG.
export const uploadPath = z.string().regex(/^src\/assets\/uploads\/[a-z][a-z0-9-]*\.png$/);
export const imageSchema = z.object({
  src: uploadPath,
  alt: z.string().trim().min(10).refine(
    (value) => !/^(image|photo|picture|test|placeholder|n\/?a)[\s\d.]*$/i.test(value),
    'Describe the image meaningfully',
  ),
  usage: z.object({
    authorization: z.enum(['synthetic', 'owned', 'licensed', 'permission']),
    credit: text,
    authorizationReference: text,
  }),
});
const availability = z.enum(['available', 'coming-soon', 'unavailable']);
const publicPropertyFields = {
  title: text,
  location: text,
  monthlyRent: measure,
  bedrooms: z.number().int().nonnegative().nullable(),
  bathrooms: measure,
  squareFeet: measure,
  availability,
  description: z.string().trim().min(20),
  images: z.array(imageSchema).min(1),
};

export const propertyStorageSchema = z.object({
  propertyId: identifier,
  publicationStatus,
  title: text.optional(),
  location: text.optional(),
  monthlyRent: measure.optional(),
  bedrooms: z.number().int().nonnegative().nullable().optional(),
  bathrooms: measure.optional(),
  squareFeet: measure.optional(),
  availability: availability.optional(),
  description: text.optional(),
  images: z.array(imageSchema).optional(),
});
export const propertyReadySchema = propertyStorageSchema.extend({
  publicationStatus: z.literal('published'),
  ...publicPropertyFields,
});

export const sourceSchema = z.object({
  title: text,
  url: z.url().refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  }, 'Sources must use HTTPS without credentials'),
});
export const articleStorageSchema = z.object({
  slug: identifier,
  publicationStatus,
  title: text.optional(),
  area: text.optional(),
  summary: text.optional(),
  updatedDate: dateOnly.nullable().optional(),
  sources: z.array(sourceSchema).optional(),
  coverImage: imageSchema.optional(),
});
export const articleReadySchema = articleStorageSchema.extend({
  publicationStatus: z.literal('published'),
  title: text,
  area: text,
  summary: z.string().trim().min(20),
  updatedDate: dateOnly.nullable(),
  sources: z.array(sourceSchema).min(1),
});

export type StoredProperty = z.infer<typeof propertyStorageSchema>;
export type StoredArticle = z.infer<typeof articleStorageSchema>;
export type ContentImage = z.infer<typeof imageSchema>;

export function readyProperty(data: StoredProperty) {
  return propertyReadySchema.parse(data);
}
export function readyArticle(data: StoredArticle, body: string) {
  const article = articleReadySchema.parse(data);
  z.string().trim().min(20, 'Published article requires a Markdown body').parse(body);
  return article;
}

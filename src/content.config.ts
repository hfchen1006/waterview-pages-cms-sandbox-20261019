import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { propertyStorageSchema, articleStorageSchema } from './lib/content/schemas.ts';

const properties = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/content/properties', generateId: ({ data }) => String(data.propertyId) }),
  schema: propertyStorageSchema,
});
const neighborhoods = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/neighborhoods' }),
  schema: articleStorageSchema,
});
export const collections = { properties, neighborhoods };

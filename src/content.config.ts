import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { readFile } from 'node:fs/promises';
import { cmsPropertyStorageSchema, cmsArticleStorageSchema, parseCmsArticleSource } from './lib/content/cms-compat.ts';

const properties = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/content/properties', generateId: ({ data }) => String(data.propertyId) }),
  schema: cmsPropertyStorageSchema,
});
const neighborhoodGlob = glob({ pattern: '*.md', base: './src/content/neighborhoods' });
const neighborhoods = defineCollection({
  loader: {
    ...neighborhoodGlob,
    name: 'cms-neighborhood-glob',
    async load(context) {
      return neighborhoodGlob.load({
        ...context,
        async parseData(entry) {
          if (!entry.filePath) throw new Error('Article loader requires a source file');
          const { data } = parseCmsArticleSource(await readFile(entry.filePath, 'utf8'));
          // Re-read raw scalars using the same parser as staging; never coerce a
          // Date object back into a string or accept a rolled-over calendar date.
          return context.parseData({ ...entry, data: { ...entry.data, ...data } });
        },
      });
    },
  },
  schema: cmsArticleStorageSchema,
});
export const collections = { properties, neighborhoods };

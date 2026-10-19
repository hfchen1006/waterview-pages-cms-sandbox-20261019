import { getCollection } from 'astro:content';
import { readyProperty, readyArticle } from './schemas.ts';
import { validateMarkdown } from './markdown-security.ts';

export async function publishedProperties() {
  const entries = await getCollection('properties', ({ data }) => data.publicationStatus === 'published');
  // Invalid published records throw. Availability never changes publication status.
  return entries.map(({ data }) => readyProperty(data)).sort((a, b) => a.propertyId.localeCompare(b.propertyId));
}
export async function publishedArticles() {
  const entries = await getCollection('neighborhoods', ({ data }) => data.publicationStatus === 'published');
  const articles = await Promise.all(entries.map(async (entry) => {
    await validateMarkdown(entry.body ?? '');
    return { entry, data: readyArticle(entry.data, entry.body ?? '') };
  }));
  return articles
    .sort((a, b) => a.data.slug.localeCompare(b.data.slug));
}

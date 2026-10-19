import { defineConfig } from 'astro/config';
import { stagePublishedMedia } from './src/lib/content/stage-media.ts';
import { markdownProcessor } from './src/lib/content/markdown-security.ts';

export default defineConfig({
  output: 'static',
  publicDir: './.poc-media',
  devToolbar: { enabled: false },
  markdown: { processor: markdownProcessor },
  integrations: [{
    name: 'poc-published-media-only',
    hooks: {
      'astro:config:setup': async () => { await stagePublishedMedia(); },
    },
  }],
});

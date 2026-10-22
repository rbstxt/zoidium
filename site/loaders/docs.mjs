import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { docsLoader } from '@astrojs/starlight/loaders';
import { developerDocs, rewriteMarkdown, root } from './sources.mjs';
import { referenceMarkdown } from './reference.mjs';

const require = createRequire(import.meta.url);
export function zoidiumDocs() {
  return {
    name: 'zoidium-docs',
    async load(context) {
      await docsLoader().load(context);
      async function put(id, title, body) {
        const data = await context.parseData({ id, data: { title } });
        context.store.set({ id, data, body, rendered: await context.renderMarkdown(body),
          digest: context.generateDigest(body) });
      }
      async function loadSources() {
        for (const name of developerDocs) {
          const source = `docs/${name}.md`;
          const markdown = await fs.readFile(path.join(root, source), 'utf8');
          const title = /^# (.+)$/m.exec(markdown)?.[1] || name;
          await put(`development/${name}`, title, rewriteMarkdown(markdown.replace(/^# .+\n/, ''), source));
        }
        const referencePath = require.resolve('../../plugins/shader-plus/reference.js');
        delete require.cache[referencePath];
        await put('reference/shader', 'Shader reference', referenceMarkdown(require(referencePath)));
      }
      await loadSources();
      if (context.watcher) {
        const files = developerDocs.map(id => path.join(root, `docs/${id}.md`));
        files.push(path.join(root, 'plugins/shader-plus/reference.js'));
        context.watcher.add(files);
        context.watcher.on('change', async file => { if (files.includes(file)) await loadSources(); });
      }
    },
  };
}

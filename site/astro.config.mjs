import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  base: '/docs',
  trailingSlash: 'always',
  integrations: [starlight({
    title: 'Zoidium',
    description: 'Guides and reference for the external CM3 extension layer.',
    defaultLocale: 'root',
    locales: { root: { label: 'English', lang: 'en' } },
    customCss: ['./src/styles/theme.css'],
    favicon: '/docs/favicon.svg',
    head: [{ tag: 'meta', attrs: { name: 'color-scheme', content: 'dark light' } }],
    sidebar: [
      { label: 'Start here', items: [
        { label: 'Overview', slug: '' },
        { label: 'Getting started', slug: 'getting-started' },
        { label: 'Saving and restore points', slug: 'development/project-saving' },
        { label: 'Plugin manager', slug: 'development/plugin-manager' },
      ] },
      { label: 'Feature guides', items: [{ autogenerate: { directory: 'features' } }] },
      { label: 'Shader authoring', items: [
        { label: 'Custom Shader basics', slug: 'shaders/basics' },
        { label: 'Property controls', slug: 'development/shader-properties' },
        { label: 'Kind examples', slug: 'shaders/kind-examples' },
        { label: 'Code editor', slug: 'shaders/editor' },
        { label: 'Porting shaders', slug: 'shaders/porting' },
        { label: 'Shader reference', slug: 'reference/shader' },
      ] },
      { label: 'Plugin development', items: [{ autogenerate: { directory: 'development' } }] },
      { label: 'About Zoidium', slug: 'about' },
    ],
    expressiveCode: { themes: ['github-dark', 'github-light'] },
  })],
});

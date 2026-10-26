import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  base: '/docs',
  trailingSlash: 'always',
  integrations: [starlight({
    title: 'Zoidium',
    description: 'Guides and reference for the external CM3 extension layer.',
    defaultLocale: 'root',
    locales: { root: { label: 'English', lang: 'en' }, ja: { label: '日本語', lang: 'ja' } },
    customCss: ['./src/styles/theme.css'],
    favicon: '/favicon.svg',
    head: [{ tag: 'meta', attrs: { name: 'color-scheme', content: 'dark light' } }],
    sidebar: [
      { label: 'Start here', translations: { ja: 'はじめに' }, items: [
        { label: 'Overview', translations: { ja: '概要' }, slug: '' },
        { label: 'Getting started', translations: { ja: 'はじめかた' }, slug: 'getting-started' },
        { label: 'Saving and restore points', translations: { ja: '保存と復元ポイント' }, slug: 'development/project-saving' },
        { label: 'Plugin manager', translations: { ja: 'プラグインマネージャー' }, slug: 'development/plugin-manager' },
        { label: 'Troubleshooting', translations: { ja: 'トラブルシューティング' }, slug: 'troubleshooting' },
      ] },
      { label: 'Feature guides', translations: { ja: '機能ガイド' }, items: [{ autogenerate: { directory: 'features' } }] },
      { label: 'How-to guides', translations: { ja: '操作ガイド' }, items: [{ autogenerate: { directory: 'how-to' } }] },
      { label: 'Reference', translations: { ja: 'リファレンス' }, items: [{ autogenerate: { directory: 'reference' } }] },
      { label: 'Shader authoring', translations: { ja: 'シェーダーの作成' }, items: [
        { label: 'Custom Shader basics', translations: { ja: 'Custom Shader の基本' }, slug: 'shaders/basics' },
        { label: 'Property controls', translations: { ja: 'プロパティの種類' }, slug: 'development/shader-properties' },
        { label: 'Kind examples', translations: { ja: '種類ごとの例' }, slug: 'shaders/kind-examples' },
        { label: 'Code editor', translations: { ja: 'コードエディター' }, slug: 'shaders/editor' },
        { label: 'Porting shaders', translations: { ja: 'シェーダーの移植' }, slug: 'shaders/porting' },
        { label: 'Shader reference', translations: { ja: 'シェーダーリファレンス' }, slug: 'reference/shader' },
      ] },
      { label: 'Plugin development', translations: { ja: 'プラグイン開発' }, collapsed: true, items: [{ autogenerate: { directory: 'development' } }] },
      { label: 'About Zoidium', translations: { ja: 'Zoidium について' }, slug: 'about' },
      { label: 'Changelog', translations: { ja: '変更履歴' }, slug: 'changelog' },
    ],
    expressiveCode: { themes: ['github-dark', 'github-light'] },
  })],
});

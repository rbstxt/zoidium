import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const developerDocs = [
  'plugin-api', 'plugin-ui', 'expressions', 'shader-properties',
  'project-compatibility', 'project-saving', 'project-saving-internals',
  'desktop-app', 'plugin-manager', 'plugin-manager-internals',
];
export const featureIds = [
  'shape-plus', 'text-plus', 'geometry-plus', 'material-plus', 'node-effect',
  'magic-looks', 'expressions-plus', 'shader-plus', 'motion-path', 'constraints',
  'camera-plus', 'mp4-export', 'alipfx', 'trapcode-suite',
];
const routes = new Map(developerDocs.map(id => [`docs/${id}.md`, `development/${id}/`]));
for (const id of featureIds) routes.set(`plugins/${id}/README.md`, `features/${id}/`);

// Resolve repository-relative Markdown links without modifying their canonical sources.
// locale is "root" for English or "ja" for Japanese; routes gain a ja/ prefix.
export function rewriteLink(url, source, locale = 'root') {
  const prefix = locale === 'ja' ? 'ja/' : '';
  // Japanese sources live under docs/ja/ but link like their English originals.
  if (locale === 'ja') source = source.replace(/^docs\/ja\//, 'docs/');
  if (/^(?:[a-z]+:|\/|#)/i.test(url)) {
    if (locale === 'ja' && url.startsWith('/docs/') && !url.startsWith('/docs/ja/')) {
      return url.replace(/^\/docs\//, '/docs/ja/');
    }
    return url;
  }
  const [file, fragment] = url.split('#');
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(source), file));
  const route = routes.get(resolved);
  if (route) return `/docs/${prefix}${route}${fragment ? '#' + fragment : ''}`;
  return `https://github.com/rbstxt/zoidium/blob/dev/${resolved}${fragment ? '#' + fragment : ''}`;
}

export function rewriteMarkdown(body, source, locale = 'root') {
  return body.replace(/(\]\()([^\s)]+)(\))/g, (_, start, url, end) => start + rewriteLink(url, source, locale) + end);
}

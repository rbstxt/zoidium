import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const developerDocs = [
  'plugin-api', 'plugin-ui', 'expressions', 'shader-properties',
  'project-compatibility', 'project-saving', 'project-saving-internals',
  'desktop-app', 'plugin-manager', 'plugin-manager-internals',
];
export const pluginRoutes = {
  'shape-plus': '2d-and-text/shape-plus/',
  'text-plus': '2d-and-text/text-plus/',
  'geometry-plus': '3d/geometry-plus/',
  'material-plus': '3d/material-plus/',
  'node-effect': 'effects/node-effect/',
  'magic-looks': 'effects/magic-looks/',
  'expressions-plus': 'animation/expressions-plus/',
  'shader-plus': 'shaders/property-settings/',
  'motion-path': 'animation/motion-paths/',
  'constraints': '3d/constraints/',
  'camera-plus': '3d/camera-plus/',
  'mp4-export': 'workflow/export/',
  'alipfx': 'effects/shader-packs/',
  'trapcode-suite': '3d/trapcode-suite/',
};
export const featureIds = Object.keys(pluginRoutes);
const routes = new Map(developerDocs.map(id => [`docs/${id}.md`, `development/${id}/`]));
for (const [id, target] of Object.entries(pluginRoutes)) routes.set(`plugins/${id}/README.md`, target);
// docs/project-compatibility.md links directly to the Constraints user page.
routes.set('site/src/content/docs/3d/constraints.md', '3d/constraints/');

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

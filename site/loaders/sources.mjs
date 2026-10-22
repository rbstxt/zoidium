import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const developerDocs = [
  'plugin-api', 'plugin-ui', 'expressions', 'shader-properties',
  'project-compatibility', 'project-saving', 'desktop-app', 'plugin-manager',
];
export const featureIds = [
  'shape-plus', 'text-plus', 'geometry-plus', 'material-plus', 'node-effect',
  'magic-looks', 'expressions-plus', 'shader-plus', 'motion-path', 'constraints',
  'camera-plus', 'mp4-export', 'alipfx', 'trapcode-suite',
];
const routes = new Map(developerDocs.map(id => [`docs/${id}.md`, `development/${id}/`]));
for (const id of featureIds) routes.set(`plugins/${id}/README.md`, `features/${id}/`);

// Resolve repository-relative Markdown links without modifying their canonical sources.
export function rewriteLink(url, source) {
  if (/^(?:[a-z]+:|\/|#)/i.test(url)) return url;
  const [file, fragment] = url.split('#');
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(source), file));
  const route = routes.get(resolved);
  if (route) return `/docs/${route}${fragment ? '#' + fragment : ''}`;
  return `https://github.com/rbstxt/zoidium/blob/dev/${resolved}${fragment ? '#' + fragment : ''}`;
}

export function rewriteMarkdown(body, source) {
  return body.replace(/(\]\()([^\s)]+)(\))/g, (_, start, url, end) => start + rewriteLink(url, source) + end);
}

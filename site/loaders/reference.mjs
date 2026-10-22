export function referenceMarkdown(reference) {
  const lines = ['This reference is generated from the same versioned data used by Shader+ completion and help. IDs remain stable for editor links.',
    '', '## Contents', ''];
  const groups = [ ['builtin', 'Built-in uniforms and varyings'], ['include', 'Includes'],
    ['helper', 'Helper functions'], ['kind', 'Property kinds'] ];
  for (const [category, title] of groups) {
    lines.push(`\n## ${title}\n`);
    const entries = reference.entries.filter(e => e.category === category);
    lines.push(entries.map(e => `[${e.name}](#${e.id})`).join(' · '), '');
    for (const e of entries) {
      lines.push(`<h3 id="${e.id}">${e.name}</h3>`, '', e.description, '',
        '```glsl', e.signature, '```', '', '**Example**', '', '```glsl', e.example, '```', '');
      if (e.provider) lines.push(`Provider: \`${e.provider}\`.`, '');
      if (e.include) lines.push('```glsl', `// #include <${e.include}>`, '```', '');
      if (e.types) lines.push(`Accepted GLSL types: ${e.types.map(t => '`' + t + '`').join(', ')}.`,
        `Native storage type: \`${e.storageType}\`. ${e.dynamic ? 'Dynamic' : 'Static'} property.`, '');
      for (const aux of e.auxiliary || []) {
        lines.push(aux.description, '', '```glsl', aux.signature, '```', '');
      }
      if (e.kind === 'point') lines.push('Point is retained for saved properties and is hidden from the add menu.', '');
    }
  }
  return lines.join('\n');
}

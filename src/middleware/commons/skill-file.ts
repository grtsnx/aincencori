// Skills from outside: a SKILL.md file (the common "Agent Skills" format):
// a short header with a name and a description, then the steps.
//
//   ---
//   name: meeting-notes
//   description: Turn a meeting transcript into short notes.
//   ---
//   1. Read the transcript...

export interface SkillFile {
  name: string;
  description: string;
  instructions: string;
}

// A GitHub page for a skill folder or file, as the raw SKILL.md address.
// Other addresses are kept as they are.
export function skillFileUrl(value: string): string {
  const url = new URL(value);
  if (url.hostname !== 'github.com') return url.toString();
  const [owner, repo, kind, ref, ...rest] = url.pathname
    .split('/')
    .filter(Boolean);
  if (!owner || !repo) return url.toString();
  if (kind !== 'tree' && kind !== 'blob') {
    // The repository itself: its SKILL.md at the top of the main branch.
    return `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/SKILL.md`;
  }
  const path = rest.join('/');
  const file =
    kind === 'blob' || /\.md$/i.test(path)
      ? path
      : `${path ? `${path}/` : ''}SKILL.md`;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${file}`;
}

// Reads a SKILL.md. Without a header, the first heading names it.
export function parseSkillFile(text: string): SkillFile | null {
  const body = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const header = /^---\n([\s\S]*?)\n---\n?/.exec(body);
  const fields: Record<string, string> = {};
  if (header) {
    for (const line of header[1].split('\n')) {
      const match = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
      if (match) fields[match[1].toLowerCase()] = unquote(match[2]);
    }
  }
  const instructions = (header ? body.slice(header[0].length) : body).trim();
  const heading = /^#\s+(.+)$/m.exec(instructions)?.[1];
  const name = slug(fields.name ?? heading ?? '');
  const description = (
    fields.description ??
    instructions
      .split('\n')
      .find((line) => line.trim() && !line.startsWith('#')) ??
    ''
  )
    .trim()
    .slice(0, 300);
  if (!name || !instructions) return null;
  return { name, description: description || name, instructions };
}

function unquote(value: string): string {
  return value.trim().replace(/^(['"])(.*)\1$/, '$2');
}

// Lowercase words with dashes, as skill names are.
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

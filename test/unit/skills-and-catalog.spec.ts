import { describe, expect, it } from 'vitest';
import { parseSkillFile, skillFileUrl } from '@/middleware';
import { catalogServer } from '@/modules/integration/integration.service.js';

describe('skills from outside', () => {
  it('turns GitHub links into the raw SKILL.md', () => {
    expect(
      skillFileUrl(
        'https://github.com/anthropics/skills/tree/main/skills/brand-guidelines',
      ),
    ).toBe(
      'https://raw.githubusercontent.com/anthropics/skills/main/skills/brand-guidelines/SKILL.md',
    );
    expect(
      skillFileUrl('https://github.com/acme/tools/blob/v2/notes/SKILL.md'),
    ).toBe('https://raw.githubusercontent.com/acme/tools/v2/notes/SKILL.md');
    expect(skillFileUrl('https://github.com/acme/one-skill')).toBe(
      'https://raw.githubusercontent.com/acme/one-skill/HEAD/SKILL.md',
    );
    expect(skillFileUrl('https://example.com/skills/SKILL.md')).toBe(
      'https://example.com/skills/SKILL.md',
    );
  });

  it('reads the name, description and steps of a SKILL.md', () => {
    expect(
      parseSkillFile(
        '---\nname: "Meeting Notes"\ndescription: Short notes from a call.\n---\n# Notes\n1. Read it.',
      ),
    ).toEqual({
      name: 'meeting-notes',
      description: 'Short notes from a call.',
      instructions: '# Notes\n1. Read it.',
    });
    // No header: the first heading names it.
    expect(parseSkillFile('# Weekly Report\nPull the deals.')).toEqual({
      name: 'weekly-report',
      description: 'Pull the deals.',
      instructions: '# Weekly Report\nPull the deals.',
    });
    expect(parseSkillFile('')).toBeNull();
  });
});

describe('MCP catalog', () => {
  const entry = (remote: Record<string, unknown>) => ({
    server: {
      name: 'acme/tools',
      description: 'Tools.',
      version: '1.0.0',
      remotes: [remote],
    },
  });

  it('offers servers we can reach: online, with at most a Bearer token', () => {
    expect(
      catalogServer(
        entry({ type: 'streamable-http', url: 'https://mcp.acme.com/mcp' }),
      ),
    ).toMatchObject({
      server: 'acme/tools',
      title: 'tools',
      needsToken: false,
    });
    expect(
      catalogServer(
        entry({
          type: 'streamable-http',
          url: 'https://mcp.acme.com/mcp',
          headers: [
            {
              name: 'Authorization',
              value: 'Bearer {key}',
              description: 'Your Acme key',
              isRequired: true,
            },
          ],
        }),
      ),
    ).toMatchObject({ needsToken: true, tokenHint: 'Your Acme key' });
  });

  it('leaves out servers we cannot connect to', () => {
    // Runs on a laptop, not online.
    expect(catalogServer(entry({ type: 'stdio' }))).toBeNull();
    // An address with blanks to fill in.
    expect(
      catalogServer(
        entry({
          type: 'streamable-http',
          url: 'https://{tenant}.acme.com/mcp',
        }),
      ),
    ).toBeNull();
    // A different header we cannot send.
    expect(
      catalogServer(
        entry({
          type: 'streamable-http',
          url: 'https://mcp.acme.com/mcp',
          headers: [{ name: 'X-Acme-Key', isRequired: true }],
        }),
      ),
    ).toBeNull();
    expect(
      catalogServer(
        entry({ type: 'streamable-http', url: 'http://mcp.acme.com' }),
      ),
    ).toBeNull();
  });
});

import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CencoriService } from '@/lib/cencori/cencori.service.js';

describe('CencoriService', () => {
  it('answers 503 when CENCORI_API_KEY is not set', () => {
    const service = new CencoriService(null);

    expect(service.isConfigured).toBe(false);
    expect(() => service.aiChat({ model: 'x', messages: [] })).toThrow(
      ServiceUnavailableException,
    );
  });

  it('passes calls straight to the Cencori SDK', async () => {
    const chat = vi.fn().mockResolvedValue({ content: 'Hello' });
    const client = { ai: { chat } } as never;
    const service = new CencoriService(client);
    const request = {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user' as const, content: 'Hi' }],
    };

    await expect(service.aiChat(request)).resolves.toEqual({
      content: 'Hello',
    });
    expect(chat).toHaveBeenCalledWith(request);
    expect(service.isConfigured).toBe(true);
    expect(service.sdk).toBe(client);
  });

  it('verifies webhooks and removes skills through the SDK', async () => {
    const verify = vi.fn().mockResolvedValue(true);
    const remove = vi.fn().mockResolvedValue({ ok: true });
    const service = new CencoriService({
      webhooks: { verify, events: ['run.completed'] },
      skills: { remove },
    } as never);

    await expect(
      service.webhooksVerify('{"a":1}', 'sig', 'whsec_x'),
    ).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('{"a":1}', 'sig', 'whsec_x');
    expect(service.webhookEvents).toEqual(['run.completed']);

    await service.skillsRemove('skill_1');
    expect(remove).toHaveBeenCalledWith('skill_1');
  });
});

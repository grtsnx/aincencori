import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { LivekitService } from '@/lib/livekit/livekit.service.js';
import { VoiceService } from '@/modules/voice/voice.service.js';

const config = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as never;
const live = config({
  LIVEKIT_URL: 'wss://agentic.livekit.cloud',
  LIVEKIT_API_KEY: 'APIkey123',
  LIVEKIT_API_SECRET: 'secret-secret-secret-secret-secret-1',
});
const claims = (token: string) =>
  JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
const auth = { user: { id: 'u1', name: 'Ada' } } as never;

function voice(found: { bot?: boolean; group?: boolean } = {}) {
  const prisma = {
    db: {
      bot: {
        findFirst: vi.fn().mockResolvedValue(found.bot ? { id: 'b1' } : null),
      },
      botGroup: {
        findFirst: vi.fn().mockResolvedValue(found.group ? { id: 'g1' } : null),
      },
    },
  };
  return {
    service: new VoiceService(
      new LivekitService(live),
      prisma as never,
      allowance as never,
    ),
    prisma,
  };
}

// The user still has AI allowance left.
const allowance = { assertAllowance: () => Promise.resolve() };

describe('voice calls', () => {
  it('answers 503 until LiveKit is set up', async () => {
    const service = new VoiceService(
      new LivekitService(config({})),
      {} as never,
      allowance as never,
    );
    await expect(service.startCall(auth, {})).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('gives a short-lived ticket for one private room, as the user', async () => {
    const { service } = voice({ bot: true });

    const call = await service.startCall(auth, { botId: 'b1' });

    expect(call.url).toBe('wss://agentic.livekit.cloud');
    expect(call.room).toMatch(/^call-[0-9a-f-]{36}$/);
    const ticket = claims(call.token);
    expect(ticket.sub).toBe('u1');
    expect(ticket.video).toMatchObject({ room: call.room, roomJoin: true });
    expect(ticket.exp - ticket.nbf).toBeLessThanOrEqual(10 * 60);
    // Our voice worker is called in, and told who is calling and which bot.
    const [agent] = ticket.roomConfig.agents;
    expect(agent.agentName).toBe('agentic-voice');
    expect(JSON.parse(agent.metadata)).toEqual({
      mode: 'call',
      userId: 'u1',
      botId: 'b1',
    });
  });

  it('makes a new room for every call', async () => {
    const { service } = voice();
    const [a, b] = await Promise.all([
      service.startCall(auth, {}),
      service.startCall(auth, {}),
    ]);
    expect(a.room).not.toBe(b.room);
  });

  it("only calls the user's own bot or group", async () => {
    const { service, prisma } = voice();

    await expect(service.startCall(auth, { botId: 'theirs' })).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.db.bot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'theirs', userId: 'u1', enabled: true },
      }),
    );
    await expect(
      service.startCall(auth, { groupId: 'theirs' }),
    ).rejects.toThrow('Group not found.');
    await expect(
      service.startCall(auth, { botId: 'b', groupId: 'g' }),
    ).rejects.toThrow('not both');
  });

  it('gives a voice typing ticket: no bot, the chosen language', async () => {
    const { service } = voice();

    const typing = await service.startDictation(auth, { language: 'fr' });

    expect(typing.room).toMatch(/^dictate-[0-9a-f-]{36}$/);
    const [agent] = claims(typing.token).roomConfig.agents;
    expect(JSON.parse(agent.metadata)).toEqual({
      mode: 'dictate',
      userId: 'u1',
      language: 'fr',
    });
    const defaults = await service.startDictation(auth, {});
    expect(
      JSON.parse(claims(defaults.token).roomConfig.agents[0].metadata).language,
    ).toBe('en');
  });
});

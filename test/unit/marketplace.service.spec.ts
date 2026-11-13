import { describe, expect, it, vi } from 'vitest';
import { MarketplaceService } from '@/modules/marketplace/marketplace.service.js';

function createService(
  listing: Record<string, unknown> = {},
  verdict: { safe: boolean; reason: string } = { safe: true, reason: '' },
) {
  const row = {
    id: 'l1',
    botId: 'b1',
    userId: 'u1',
    authorName: 'Ada',
    name: 'Cold Email Bot',
    description: 'Writes cold emails.',
    instructions: 'Write short cold emails.',
    skills: [],
    category: 'sales',
    status: 'reviewing',
    reviewNote: null,
    importCount: 0,
    publishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date('2026-11-13T10:00:00.000Z'),
    ...listing,
  };
  let job:
    | ((
        data: { listingId: string },
        meta: { attempt: number },
      ) => Promise<void>)
    | undefined;
  const db = {
    listing: {
      findUnique: vi.fn().mockResolvedValue(row),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const bullmq = {
    handle: vi.fn((_name: string, handler: typeof job) => (job = handler)),
    add: vi.fn().mockResolvedValue(undefined),
  };
  const cencori = {
    isConfigured: true,
    agentRun: vi
      .fn()
      .mockResolvedValue({ sessionId: 'review-session', finalOutput: verdict }),
  };
  const service = new MarketplaceService(
    { db } as never,
    bullmq as never,
    cencori as never,
    {} as never,
    {} as never,
  );
  service.onModuleInit();
  const review = (attempt = 1) => {
    if (!job) throw new Error('The review job was not registered.');
    return job({ listingId: 'l1' }, { attempt });
  };
  return { db, cencori, bullmq, review };
}

describe('Marketplace safety review', () => {
  it('publishes a bot the reviewer finds safe, and removes its chat', async () => {
    const { db, bullmq, review } = createService();

    await review();

    expect(db.listing.updateMany).toHaveBeenCalledWith({
      // Not if a newer version was shared meanwhile.
      where: {
        id: 'l1',
        status: 'reviewing',
        updatedAt: new Date('2026-11-13T10:00:00.000Z'),
      },
      data: expect.objectContaining({ status: 'published', reviewNote: null }),
    });
    expect(bullmq.add).toHaveBeenCalledWith('cencori-session-delete', {
      sessionId: 'review-session',
    });
  });

  it('rejects an unsafe bot with the reviewer’s reason', async () => {
    const { db, review } = createService(
      {},
      { safe: false, reason: 'It asks users for card numbers.' },
    );

    await review();

    expect(db.listing.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: 'rejected',
          reviewNote: 'It asks users for card numbers.',
        },
      }),
    );
  });

  it('rejects a key in a skill without asking the AI', async () => {
    const { db, cencori, review } = createService({
      skills: [
        {
          name: 'post',
          description: 'Posts data.',
          instructions: 'Send with AKIAABCDEFGHIJKLMNOP.',
        },
      ],
    });

    await review();

    expect(cencori.agentRun).not.toHaveBeenCalled();
    expect(db.listing.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'rejected' }),
      }),
    );
  });

  it('leaves the bot to staff when the reviewer keeps failing', async () => {
    const { db, cencori, review } = createService();
    cencori.agentRun.mockRejectedValue(new Error('Cencori away'));

    await expect(review(1)).rejects.toThrow('Cencori away');
    await review(3);

    expect(db.listing.updateMany).not.toHaveBeenCalled();
  });
});

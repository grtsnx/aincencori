import { NestFactory } from '@nestjs/core';
import { Room, RoomEvent, AudioStream, TrackKind } from '@livekit/rtc-node';
import { randomUUID } from 'node:crypto';
const root = '/Users/grtsnx/Programming/aincencori/dist';
const { AppModule } = await import(`${root}/app/app.module.js`);
const { VoiceService } = await import(`${root}/modules/voice/voice.service.js`);
const { PrismaService } = await import(`${root}/lib/prisma/prisma.service.js`);
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
const voice = app.get(VoiceService, { strict: false });
const db = app.get(PrismaService, { strict: false }).db;
const userId = 'voice-test-' + randomUUID();
await db.user.create({ data: { id: userId, name: 'Voice Test', email: `${userId}@example.com` } });
const t0 = Date.now(); const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const room = new Room();
try {
  const ticket = await voice.startCall({ user: { id: userId, name: 'Voice Test' } }, {});
  console.log('ticket for room', ticket.room.slice(0, 12) + '…', at());
  let frames = 0, agentJoined = false;
  room.on(RoomEvent.ParticipantConnected, (p) => { agentJoined = true; console.log('joined:', p.identity.slice(0, 20), 'kind', p.kind, at()); });
  room.on(RoomEvent.TrackSubscribed, async (track, pub, p) => {
    if (track.kind !== TrackKind.KIND_AUDIO) return;
    console.log('bot audio track', at());
    for await (const frame of new AudioStream(track)) {
      let loud = 0; for (const v of frame.data) if (Math.abs(v) > 500) loud++;
      if (loud > 10) frames++;
      if (frames === 1) console.log('bot is speaking', at());
    }
  });
  await room.connect(ticket.url, ticket.token, { autoSubscribe: true, dynacast: false });
  console.log('connected to LiveKit', at());
  for (let i = 0; i < 40 && frames < 100; i++) await new Promise((r) => setTimeout(r, 500));
  console.log('agent joined:', agentJoined, '| speech frames heard:', frames);
} catch (e) { console.log('FAILED:', e?.message ?? e); }
finally {
  await room.disconnect().catch(() => {});
  // The worker saves the speech cost when the call ends.
  await new Promise((r) => setTimeout(r, 8000));
  const used = await db.usageDay.findMany({ where: { userId } });
  console.log('usage rows:', JSON.stringify(used.map((u) => ({ kind: u.kind, calls: u.calls, costUsd: u.costUsd }))));
  for (const t of ['usageDay', 'chatMessage', 'activityLog']) await db[t].deleteMany({ where: t === 'chatMessage' ? { session: { userId } } : { userId } }).catch(() => {});
  await db.chatSession.deleteMany({ where: { userId } });
  await db.user.delete({ where: { id: userId } });
  await app.close();
}

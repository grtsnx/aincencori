import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { voiceAgentName, voiceTicketSeconds } from '@/config/agents/limits.js';
import type { StartCallDto, StartDictationDto, VoiceCallDto } from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { LivekitService } from '@/lib/livekit/livekit.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';

// Voice, two ways. Calls: the user talks with the default assistant, one of their
// bots or one of their groups, like a phone call. We give the app a ticket
// for a private LiveKit room; our voice worker joins it, turns speech into
// text, asks the bot through the normal chat (so memories, skills and
// integrations all apply, and the call is saved as a chat), and speaks the
// answer.
@Injectable()
export class VoiceService {
  constructor(
    private readonly livekit: LivekitService,
    private readonly prisma: PrismaService,
  ) {}

  async startCall(
    auth: AuthSession,
    body: StartCallDto,
  ): Promise<VoiceCallDto> {
    const userId = auth.user.id;
    if (body.botId && body.groupId) {
      throw new BadRequestException('Choose a bot or a group, not both.');
    }
    // Only the user's own bot or group, and only one that is on.
    if (body.botId) {
      const bot = await this.prisma.db.bot.findFirst({
        where: { id: body.botId, userId, enabled: true },
        select: { id: true },
      });
      if (!bot) throw new NotFoundException('Bot not found.');
    }
    if (body.groupId) {
      const group = await this.prisma.db.botGroup.findFirst({
        where: { id: body.groupId, userId },
        select: { id: true },
      });
      if (!group) throw new NotFoundException('Group not found.');
    }
    return this.livekit.ticket({
      // A fresh room per call, so nobody can guess or reuse it.
      room: `call-${randomUUID()}`,
      identity: userId,
      name: auth.user.name,
      agentName: voiceAgentName,
      details: {
        mode: 'call',
        userId,
        botId: body.botId,
        groupId: body.groupId,
      },
      seconds: voiceTicketSeconds,
    });
  }

  // Voice typing: the user speaks and sees their words appear as they talk,
  // to send as a normal message. No bot answers; nothing is saved here.
  async startDictation(
    auth: AuthSession,
    body: StartDictationDto,
  ): Promise<VoiceCallDto> {
    return this.livekit.ticket({
      room: `dictate-${randomUUID()}`,
      identity: auth.user.id,
      name: auth.user.name,
      agentName: voiceAgentName,
      details: {
        mode: 'dictate',
        userId: auth.user.id,
        language: body.language ?? 'en',
      },
      seconds: voiceTicketSeconds,
    });
  }
}

import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  voiceAgentName,
  voiceMeterEveryMs,
  voiceSttMinuteUsd,
  voiceTicketSeconds,
  voiceTtsCharUsd,
} from '@/config/agents/limits.js';
import type { StartCallDto, StartDictationDto, VoiceCallDto } from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { LivekitService } from '@/lib/livekit/livekit.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { UsageService } from '../usage/usage.service.js';

// The speech numbers LiveKit reports during a call, and what we do with them.
export interface VoiceMeter {
  add(metrics: {
    type: string;
    audioDurationMs?: number;
    charactersCount?: number;
  }): void;
  // The call ended: save what is left.
  stop(): Promise<void>;
}

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
    private readonly usage: UsageService,
  ) {}

  async startCall(
    auth: AuthSession,
    body: StartCallDto,
  ): Promise<VoiceCallDto> {
    const userId = auth.user.id;
    if (body.botId && body.groupId) {
      throw new BadRequestException('Choose a bot or a group, not both.');
    }
    await this.usage.assertAllowance(userId);
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

  // Counts what a live call's speech costs: listening (per minute of audio)
  // and speaking (per character). The bot's answers are counted already, like
  // any chat. Every minute it saves the cost and checks the allowance; when
  // it is used up, `onLimit` runs once so the call can end.
  meter(userId: string, onLimit: () => void): VoiceMeter {
    let heardMs = 0;
    let spokenChars = 0;
    let ended = false;
    const save = async () => {
      const costUsd =
        (heardMs / 60_000) * voiceSttMinuteUsd + spokenChars * voiceTtsCharUsd;
      heardMs = 0;
      spokenChars = 0;
      if (costUsd > 0) {
        await this.usage.record(userId, 'voice', {
          inputTokens: 0,
          outputTokens: 0,
          costUsd,
        });
      }
    };
    const check = async () => {
      await save();
      try {
        await this.usage.assertAllowance(userId);
      } catch (error) {
        // Only a used-up allowance ends the call, not a database hiccup.
        const usedUp =
          error instanceof HttpException &&
          error.getStatus() === HttpStatus.PAYMENT_REQUIRED;
        if (usedUp && !ended) {
          ended = true;
          onLimit();
        }
      }
    };
    const timer = setInterval(() => void check(), voiceMeterEveryMs);
    timer.unref?.();
    return {
      add: (metrics) => {
        if (metrics.type === 'stt_metrics') {
          heardMs += Math.max(0, metrics.audioDurationMs ?? 0);
        } else if (metrics.type === 'tts_metrics') {
          spokenChars += Math.max(0, metrics.charactersCount ?? 0);
        }
      },
      stop: async () => {
        clearInterval(timer);
        ended = true;
        await save();
      },
    };
  }

  // Voice typing: the user speaks and sees their words appear as they talk,
  // to send as a normal message. No bot answers; nothing is saved here.
  async startDictation(
    auth: AuthSession,
    body: StartDictationDto,
  ): Promise<VoiceCallDto> {
    await this.usage.assertAllowance(auth.user.id);
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

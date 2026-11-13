import {
  cli,
  defineAgent,
  inference,
  type JobContext,
  type JobProcess,
  type llm,
  ServerOptions,
  voice,
} from '@livekit/agents';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ReadableStream } from 'node:stream/web';
import { fileURLToPath } from 'node:url';
import { AppModule } from '@/app';
import {
  agentModel,
  voiceAgentName,
  voiceSttModel,
  voiceTtsModel,
  voiceTtsVoice,
} from '@/config/agents/limits.js';
import { ChatService } from '@/modules/chat/chat.service.js';

// The voice worker: it joins each live call (a LiveKit room), turns what the
// user says into text, asks our bot through the normal chat, and speaks the
// answer. So a call uses the same bots, memories, skills and integrations as
// a typed chat, and is saved as a chat.
//
// Run it beside the API: `bun run start:voice` (needs LIVEKIT_URL,
// LIVEKIT_API_KEY, LIVEKIT_API_SECRET). LiveKit starts one process per call.

// Who is calling and which bot, signed into the call ticket by our API.
interface CallDetails {
  userId?: string;
  botId?: string;
  groupId?: string;
}

// Speech has no use for formatting marks.
const plain = (text: string): string =>
  text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_#`>|]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

export default defineAgent({
  // Once per process, before a call arrives: load our app (database, bots).
  prewarm: async (proc: JobProcess) => {
    proc.userData.app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'fatal'],
    });
  },

  entry: async (ctx: JobContext) => {
    const app = ctx.proc.userData.app as INestApplicationContext;
    const chat = app.get(ChatService, { strict: false });
    const details = JSON.parse(ctx.job.metadata || '{}') as CallDetails;
    if (!details.userId) {
      ctx.shutdown();
      return;
    }
    const userId: string = details.userId;
    // The whole call is one chat; it starts with the first thing said.
    let chatId: string | undefined;

    // The "think" step of the call. LiveKit would ask a model here; we ask
    // our own bot instead, so the answer comes from the user's bot.
    class Caller extends voice.Agent {
      override async llmNode(
        chatCtx: llm.ChatContext,
      ): Promise<ReadableStream<string> | null> {
        const said = chatCtx.items
          .filter((item) => item.type === 'message' && item.role === 'user')
          .at(-1);
        const message =
          said?.type === 'message' ? said.textContent?.trim() : undefined;
        if (!message) return null;
        let answer: string;
        try {
          const result = await chat.ask(userId, {
            message,
            chatId,
            botId: details.botId,
            groupId: details.groupId,
            spoken: true,
            stopNote: 'I stopped',
          });
          chatId = result.chatId;
          answer = plain(result.answer);
        } catch {
          answer = 'Sorry, I could not answer that just now.';
        }
        return new ReadableStream<string>({
          start(controller) {
            controller.enqueue(
              answer || 'Sorry, I have nothing to say to that.',
            );
            controller.close();
          },
        });
      }
    }

    const session = new voice.AgentSession({
      stt: new inference.STT({ model: voiceSttModel, language: 'en' }),
      // Never called (llmNode above answers), but LiveKit only runs the
      // think step when a model is set.
      llm: new inference.LLM({ model: `openai/${agentModel}` }),
      tts: new inference.TTS({ model: voiceTtsModel, voice: voiceTtsVoice }),
      turnHandling: { turnDetection: new inference.TurnDetector() },
    });
    await session.start({
      agent: new Caller({ instructions: '' }),
      room: ctx.room,
    });
    await ctx.connect();
    await session.say('Hi, I am here. What can I do for you?');
  },
});

// Started directly (not when LiveKit loads this file for a call).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.LIVEKIT_URL) {
    throw new Error(
      'Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET to run the voice worker.',
    );
  }
  cli.runApp(
    new ServerOptions({
      agent: fileURLToPath(import.meta.url),
      // Only joins calls our API made a ticket for.
      agentName: voiceAgentName,
    }),
  );
}

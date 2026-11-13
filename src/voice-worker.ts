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
// Applied to each small piece as it arrives, so spaces are kept.
const plain = (text: string): string => text.replace(/[*_#`>|]/g, '');

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
    // The turn before this one, so a new turn waits until it is saved (and
    // the chat id is known) even when the user talked over the answer.
    let lastTurn: Promise<void> = Promise.resolve();

    // The "think" step of the call. LiveKit would ask a model here; we ask
    // our own bot instead, and pass its words on as they are written, so
    // speech starts while the rest of the answer is still coming.
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
        await lastTurn;

        let saved: () => void = () => undefined;
        lastTurn = new Promise((resolve) => (saved = resolve));
        const words = chat.askStream(userId, {
          message,
          chatId,
          botId: details.botId,
          groupId: details.groupId,
          spoken: true,
          stopNote: 'I stopped',
          onSaved: (result) => {
            chatId = result.chatId;
          },
        });
        let spoke = false;
        const finish = async () => {
          // Lets the bot finish and saves the turn, also when cut short.
          await words.return().catch(() => undefined);
          saved();
        };
        return new ReadableStream<string>({
          async pull(controller) {
            try {
              const next = await words.next();
              if (next.done) {
                if (!spoke)
                  controller.enqueue('Sorry, I have nothing to say to that.');
                controller.close();
                saved();
                return;
              }
              const piece = plain(next.value);
              if (piece) {
                spoke = true;
                controller.enqueue(piece);
              }
            } catch {
              if (!spoke)
                controller.enqueue('Sorry, I could not answer that just now.');
              controller.close();
              saved();
            }
          },
          // The user talked over the answer: stop speaking.
          cancel: finish,
        });
      }
    }

    const session = new voice.AgentSession({
      stt: new inference.STT({ model: voiceSttModel, language: 'en' }),
      // Never called (llmNode above answers), but LiveKit only runs the
      // think step when a model is set.
      llm: new inference.LLM({ model: `openai/${agentModel}` }),
      tts: new inference.TTS({ model: voiceTtsModel, voice: voiceTtsVoice }),
      turnHandling: {
        turnDetection: new inference.TurnDetector(),
        // LiveKit can start answering before the user has finished, then
        // drop the guess. Each guess would be a paid run of our bot, and
        // could save a memory from half a sentence, so we wait for the
        // whole turn. The answer still streams into speech as it is written.
        preemptiveGeneration: { enabled: false },
      },
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

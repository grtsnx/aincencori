// Limits that keep agent runs fast and costs predictable.

// The model every agent and bot uses: any model in the Cencori catalog that
// your account has credit for. Tested live on 2026-11-13:
// - gpt-6-luna with thinking off hands chats to the right bot, answers fast
//   and is the cheapest. gpt-6-sol and gpt-6.1-sol also work (dearer; they
//   need thinking 'low' or more).
// - gpt-4.1, gpt-4o and gpt-5 are being shut down by OpenAI (Dec 2026 to
//   Jan 2027): do not go back to them.
export const agentModel = 'gpt-6-luna';

// How long the model thinks before answering: 'none' is fastest.
export const agentThinking: 'none' | 'low' | 'medium' | 'high' = 'none';

// Most steps (model calls) in one run, chat or routine.
export const maxAgentTurns = 10;

// Routines: how many each user may have, and the shortest gap between runs.
export const maxRoutinesPerUser = 25;
export const minRoutineIntervalMinutes = 15;

// How many routines run at the same time on one server.
export const routineConcurrency = 5;

// MCP servers each user may connect.
export const maxIntegrationsPerUser = 10;

// Bots each user may create.
export const maxBotsPerUser = 50;

// Per bot: facts it may keep (the newest ones go into each chat), and skills.
export const maxMemoriesPerBot = 200;
export const memoriesInPrompt = 50;
export const maxSkillsPerBot = 20;

// Bots the default assistant may hand a chat to.
export const maxBotsForAssistant = 10;

// Groups of bots: how many per user, how many bots in one, and how many
// times bots may be asked while answering one message (keeps cost in check
// and stops bots talking in circles).
export const maxGroupsPerUser = 20;
export const maxBotsPerGroup = 6;
export const maxGroupAsks = 8;
// Steps one bot may take to answer a question inside a group.
export const maxGroupBotTurns = 4;

// Voice messages: the speech models (from Cencori's voice catalog), the
// default voice, and the biggest recording we accept.
export const speechToTextModel = 'whisper-1';
export const textToSpeechModel = 'tts-1';
export const defaultVoice = 'alloy';
export const maxAudioBytes = 10 * 1_048_576;
export const maxSpokenChars = 4_000;

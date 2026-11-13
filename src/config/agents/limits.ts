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

// Live voice calls (LiveKit). The worker that joins calls goes by this name,
// and uses these speech models from LiveKit Inference.
export const voiceAgentName = 'agentic-voice';
export const voiceSttModel = 'assemblyai/universal-3-6-pro';
export const voiceTtsModel = 'fishaudio/s2.1-pro';
export const voiceTtsVoice = 'fa4c9eb3dccc4806b382b40d61c6b10a';
// A call ticket works for this long; the call itself can run longer.
export const voiceTicketSeconds = 10 * 60;

// Knowledge: documents each user may keep, the biggest file, how much text
// one document may hold, and how much each search returns.
export const maxDocumentsPerUser = 100;
export const maxDocumentBytes = 10 * 1_048_576;
export const maxDocumentChunks = 2_000;
export const documentChunkChars = 1_500;
export const documentSearchResults = 5;
// Documents one bot may search.
export const maxDocumentsPerBot = 50;

// Planner: steps in one plan, and plans running at once per user.
export const maxPlanSteps = 8;
export const maxActivePlansPerUser = 3;
// Plans worked on at the same time on one server.
export const planConcurrency = 3;

// Marketplace: bots each user may share.
export const maxListingsPerUser = 20;
// Marketplace sections a shared bot can be put in.
export const listingCategories = [
  'productivity',
  'writing',
  'research',
  'sales',
  'support',
  'learning',
  'fun',
  'other',
] as const;

// How long the activity log is kept, in days.
export const activityRetentionDays = 365;

// How long a step waits in the approvals inbox before it is dropped, in days.
export const pendingApprovalDays = 14;

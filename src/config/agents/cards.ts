import { describeCron } from '@/middleware';

// The approval card for a tool call, written by our code from the tool's
// arguments, never by the AI. Every app shows the same fixed card: a title,
// one plain sentence, and the exact values that will be used.

export interface ApprovalCard {
  title: string;
  summary: string;
  fields: { label: string; value: string }[];
}

// Long values are cut, and say so.
const show = (value: unknown, max = 500): string => {
  const text =
    typeof value === 'string' ? value : (JSON.stringify(value ?? null) ?? '');
  return text.length > max ? `${text.slice(0, max)}… (cut)` : text;
};

const field = (label: string, value: unknown) => ({
  label,
  value: show(value),
});

// "create_routine" -> "Create routine".
const humanName = (tool: string) => {
  const words = tool.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

type Args = Record<string, unknown>;

const cards: Record<string, (args: Args) => ApprovalCard> = {
  change_my_name: (a) => ({
    title: 'Change your name',
    summary: `Your display name becomes "${show(a.name, 100)}".`,
    fields: [field('New name', a.name)],
  }),
  create_routine: (a) => ({
    title: 'Create a routine',
    summary: `"${show(a.name, 100)}" runs ${describeCron(String(a.cron ?? '')).toLowerCase()} (${show(a.timezone, 60)}).`,
    fields: [
      field('Name', a.name),
      field('When', describeCron(String(a.cron ?? ''))),
      field('Time zone', a.timezone),
      field('What it does', a.prompt),
    ],
  }),
  set_routine_enabled: (a) => ({
    title: a.enabled ? 'Resume a routine' : 'Pause a routine',
    summary: a.enabled
      ? 'The routine starts running on its schedule again.'
      : 'The routine stops running until you resume it.',
    fields: [field('Routine', a.id)],
  }),
  delete_routine: (a) => ({
    title: 'Delete a routine',
    summary: 'The routine is removed. Its past runs stay in your chats.',
    fields: [field('Routine', a.id)],
  }),
  start_plan: (a) => ({
    title: 'Start a plan',
    summary:
      'The goal is split into steps that run in the background. It uses your AI allowance.',
    fields: [field('Goal', a.goal)],
  }),
  update_my_instructions: (a) => ({
    title: 'Change the bot’s instructions',
    summary: 'The bot follows these new instructions from the next message.',
    fields: [field('New instructions', a.instructions)],
  }),
  computer_run_command: (a) => ({
    title: 'Run a command on your computer',
    summary:
      'Runs on your own cloud computer. It can change files there and reach the internet.',
    fields: [
      field('Command', a.command),
      field('Folder', a.cwd ?? '/data/home'),
    ],
  }),
  computer_write_file: (a) => ({
    title: 'Write a file on your computer',
    summary: 'Creates or replaces this file on your own cloud computer.',
    fields: [
      field('File', a.path),
      field('Size', `${String(a.content ?? '').length} characters`),
      field('Start of the content', show(a.content, 300)),
    ],
  }),
};

export function approvalCard(toolName: string, argsJson: string): ApprovalCard {
  let args: Args = {};
  try {
    const parsed: unknown = JSON.parse(argsJson || '{}');
    if (parsed && typeof parsed === 'object') args = parsed as Args;
  } catch {
    // Not JSON: shown as it is below.
    return {
      title: humanName(toolName),
      summary: `The AI wants to use ${humanName(toolName).toLowerCase()}.`,
      fields: [field('Details', argsJson)],
    };
  }
  const known = cards[toolName];
  if (known) return known(args);
  // An app's tool (Gmail, Slack, the user's own server): every value it
  // will send, exactly as sent.
  return {
    title: humanName(toolName),
    summary: `The AI wants to use ${humanName(toolName).toLowerCase()} with these details.`,
    fields: Object.entries(args)
      .slice(0, 20)
      .map(([key, value]) => field(humanName(key), value)),
  };
}

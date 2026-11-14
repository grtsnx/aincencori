// Background jobs that tidy up at Cencori. Named here so the code that
// queues them and the code that runs them agree.

// Removes a deleted user's space (tenant) and its app sign-ins.
export const deleteWorkspaceJob = 'cencori-tenant-delete';

// Removes the Cencori agent behind a deleted bot.
export const deleteBotAgentJob = 'cencori-agent-delete';

// Removes a chat's copy at Cencori (also side chats: a bot asked inside a
// group, the planner, the marketplace reviewer).
export const deleteCencoriSessionJob = 'cencori-session-delete';

// Removes stored chat files: some by key, or all under a prefix (one user's).
export const deleteFilesJob = 'r2-file-delete';

// Where one user's chat files live in storage.
export const userFilesPrefix = (userId: string): string => `chats/${userId}/`;

// Where one user's knowledge files live in storage.
export const userKnowledgePrefix = (userId: string): string =>
  `knowledge/${userId}/`;

// Reads a new document and makes it searchable.
export const indexDocumentJob = 'document-index';

// Works through a plan's steps.
export const runPlanJob = 'plan-run';

// Safety review of a bot shared on the marketplace.
export const reviewListingJob = 'listing-review';

// Removes activity log entries older than activityRetentionDays, daily.
export const purgeActivityJob = 'activity-purge';

// A bot learns from one of its chats: lasting facts, how the team works,
// and changes it could make to itself (see modules/bot).
export const learnFromChatJob = 'bot-learn';

// Removes a deleted user's cloud computer at InstaBox.
export const deleteComputerJob = 'computer-delete';

// Stops a deleted user's card subscription at Bachs, so they are not charged.
export const cancelSubscriptionJob = 'billing-cancel';

// Each day: reminds people whose plan, trial or hired bot ends in 3 days
// (naira plans, trials and monthly hires do not renew by themselves).
export const renewalRemindersJob = 'billing-reminders';

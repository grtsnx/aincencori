// The kinds of notification, what each is about, and whether it is also
// emailed or pushed when the user has not chosen. Every notification is in
// the app's inbox (the bell) whatever they choose.
export const notificationTypes = {
  approval: {
    label: 'A step is waiting for your approval',
    email: true,
    push: true,
  },
  routine: {
    label: 'A routine ran, failed or stopped',
    email: false,
    push: true,
  },
  plan: { label: 'A plan finished or stopped', email: true, push: true },
  billing: {
    label: 'Payments, plans, trials and credits',
    email: true,
    push: true,
  },
  marketplace: {
    label: 'Sales of your bots and payout setup',
    email: true,
    push: true,
  },
  bot: { label: 'A bot suggested an improvement', email: false, push: false },
} as const;

export type NotificationType = keyof typeof notificationTypes;

export const notificationTypeNames = Object.keys(notificationTypes) as [
  NotificationType,
  ...NotificationType[],
];

// Notifications are kept this long, then deleted.
export const notificationKeepDays = 90;

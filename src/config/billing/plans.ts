// Plans and what each may spend on AI a month (US dollars, at Cencori's
// prices). When the allowance is used up, AI work stops until next month.
// Staff can give one user a different allowance (see the Admin routes).
export const billingPlans = {
  free: { name: 'Free', monthlyLimitUsd: 2 },
  pro: { name: 'Pro', monthlyLimitUsd: 20 },
  business: { name: 'Business', monthlyLimitUsd: 100 },
} as const;

export type BillingPlanName = keyof typeof billingPlans;

export const billingPlanNames = Object.keys(billingPlans) as [
  BillingPlanName,
  ...BillingPlanName[],
];

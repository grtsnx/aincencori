import type { IncomingHttpHeaders } from 'node:http';

// Plans, prices and what each may spend on AI a month (US dollars, at
// Cencori's prices). When the allowance is used up, AI work stops until next
// month, an upgrade, or bought credits. Staff can give one user a different
// allowance (see the Admin routes).
//
// Three plans for individuals and three for businesses. Prices keep about a
// quarter over the AI included, for card fees, servers and margin.
export const billingPlans = {
  free: {
    name: 'Free',
    audience: 'individual',
    priceUsd: 0,
    monthlyLimitUsd: 2,
  },
  plus: {
    name: 'Plus',
    audience: 'individual',
    priceUsd: 9,
    monthlyLimitUsd: 6,
  },
  pro: {
    name: 'Pro',
    audience: 'individual',
    priceUsd: 29,
    monthlyLimitUsd: 20,
  },
  team: {
    name: 'Team',
    audience: 'business',
    priceUsd: 99,
    monthlyLimitUsd: 70,
  },
  business: {
    name: 'Business',
    audience: 'business',
    priceUsd: 249,
    monthlyLimitUsd: 180,
  },
  scale: {
    name: 'Scale',
    audience: 'business',
    priceUsd: 599,
    monthlyLimitUsd: 450,
  },
} as const;

export type BillingPlanName = keyof typeof billingPlans;

export const billingPlanNames = Object.keys(billingPlans) as [
  BillingPlanName,
  ...BillingPlanName[],
];

// Plans people pay for (everything but Free).
export const paidPlanNames = billingPlanNames.filter(
  (plan) => billingPlans[plan].priceUsd > 0,
);

// Extra AI credits, bought once. They are used only after the month's
// allowance, and never run out at the month's end.
export const creditPacks = {
  small: { priceUsd: 10, creditUsd: 8 },
  medium: { priceUsd: 25, creditUsd: 20 },
  large: { priceUsd: 50, creditUsd: 40 },
} as const;

export type CreditPackName = keyof typeof creditPacks;
export const creditPackNames = Object.keys(creditPacks) as [
  CreditPackName,
  ...CreditPackName[],
];

// Prices are shown in naira (NGN) to people in Nigeria and in US dollars to
// everyone else. Dollars renew by card each month; naira pays one month at a
// time (card, bank transfer), as Bachs only renews dollar cards for now.
export const billingCurrencies = ['USD', 'NGN'] as const;
export type BillingCurrency = (typeof billingCurrencies)[number];

// Naira per dollar for our prices. Check it before going live and when the
// rate moves; naira prices are rounded to the nearest ₦500.
export const ngnPerUsd = 1600;

export function priceIn(usd: number, currency: BillingCurrency): number {
  if (currency === 'USD') return usd;
  return Math.round((usd * ngnPerUsd) / 500) * 500;
}

// Countries that see naira first.
export const ngnCountries = ['NG'];

// A free trial of any paid plan: no card, once per account. Sentinel's
// free-trial check stops people making new accounts for more trials.
export const trialDays = 7;

// How long one naira payment keeps a plan.
export const prepaidDays = 30;

// Paid bots on the marketplace: our share of each sale (the rest goes to
// the creator through Bachs), and the price range a creator may set.
export const marketplaceFeePercent = 20;
export const listingPriceUsd = { min: 1, max: 1000 };
// How long one monthly payment for a hired bot lasts.
export const hireMonthDays = 30;

// The currency to show: the one asked for, else naira for people in Nigeria
// (from the country header our host or CDN adds), else dollars.
export function currencyFor(
  headers: IncomingHttpHeaders,
  asked?: BillingCurrency,
): BillingCurrency {
  if (asked) return asked;
  const country = [
    headers['cf-ipcountry'],
    headers['x-vercel-ip-country'],
    headers['x-country-code'],
  ]
    .flat()
    .find((value): value is string => typeof value === 'string');
  return country && ngnCountries.includes(country.toUpperCase())
    ? 'NGN'
    : 'USD';
}

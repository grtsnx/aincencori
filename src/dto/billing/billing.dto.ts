import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import {
  billingCurrencies,
  creditPackNames,
  paidPlanNames,
} from '@/config/billing/plans.js';

export class PlanPriceDto {
  @ApiProperty({ example: 'pro' })
  plan: string;

  @ApiProperty({ example: 'Pro' })
  name: string;

  @ApiProperty({ enum: ['individual', 'business'], example: 'individual' })
  audience: string;

  @ApiProperty({ description: 'A month, in the currency below', example: 29 })
  price: number;

  @ApiProperty({ enum: billingCurrencies, example: 'USD' })
  currency: string;

  @ApiProperty({ description: 'AI included a month, USD', example: 20 })
  monthlyLimitUsd: number;

  @ApiProperty({
    description: 'Renews by itself (dollar card), or one month at a time',
    example: true,
  })
  renews: boolean;
}

export class CreditPackDto {
  @ApiProperty({ example: 'small' })
  pack: string;

  @ApiProperty({ example: 10 })
  price: number;

  @ApiProperty({ enum: billingCurrencies, example: 'USD' })
  currency: string;

  @ApiProperty({ description: 'AI credit it adds, USD', example: 8 })
  creditUsd: number;
}

export class PriceListDto {
  @ApiProperty({
    enum: billingCurrencies,
    description: 'Picked from the country, unless asked',
    example: 'USD',
  })
  currency: string;

  @ApiProperty({ description: 'Days of the free trial', example: 7 })
  trialDays: number;

  @ApiProperty({ type: [PlanPriceDto] })
  plans: PlanPriceDto[];

  @ApiProperty({ type: [CreditPackDto] })
  creditPacks: CreditPackDto[];
}

export class PriceListQueryDto {
  @ApiPropertyOptional({
    enum: billingCurrencies,
    description: 'Leave out to pick from the country (Nigeria: NGN)',
    example: 'NGN',
  })
  @IsOptional()
  @IsIn(billingCurrencies)
  currency?: 'USD' | 'NGN';
}

export class BillingDto {
  @ApiProperty({ example: 'pro' })
  plan: string;

  @ApiProperty({
    description: 'free, staff, trial, subscription or prepaid',
    example: 'subscription',
  })
  source: string;

  @ApiProperty({
    description: 'active, trialing, past_due or canceled',
    example: 'active',
  })
  status: string;

  @ApiProperty({ example: 'USD', nullable: true })
  currency: string | null;

  @ApiProperty({
    description: 'When the trial, paid month or card period ends',
    example: '2026-12-14T09:00:00.000Z',
    nullable: true,
  })
  paidUntil: Date | null;

  @ApiProperty({ description: 'Ends at paidUntil', example: false })
  cancelAtPeriodEnd: boolean;

  @ApiProperty({ description: 'The free trial is still unused', example: true })
  trialAvailable: boolean;

  @ApiProperty({ description: 'Bought AI credits left, USD', example: 8 })
  creditUsd: number;

  @ApiProperty({
    description: 'There is a customer portal to open',
    example: true,
  })
  hasPortal: boolean;
}

export class CheckoutDto {
  @ApiProperty({
    description: 'Send the user here to pay',
    example: 'https://checkout.bachs.io/c/chk_123',
  })
  url: string;

  @ApiProperty({ example: '2026-11-14T10:00:00.000Z' })
  expiresAt: string;
}

export class StartCheckoutDto {
  @ApiProperty({ enum: paidPlanNames, example: 'pro' })
  @IsIn(paidPlanNames)
  plan: string;

  @ApiPropertyOptional({
    enum: billingCurrencies,
    description: 'USD renews by card; NGN pays one month',
    example: 'USD',
  })
  @IsOptional()
  @IsIn(billingCurrencies)
  currency?: 'USD' | 'NGN';
}

export class BuyCreditsDto {
  @ApiProperty({ enum: creditPackNames, example: 'small' })
  @IsIn(creditPackNames)
  pack: string;

  @ApiPropertyOptional({ enum: billingCurrencies, example: 'NGN' })
  @IsOptional()
  @IsIn(billingCurrencies)
  currency?: 'USD' | 'NGN';
}

export class StartTrialDto {
  @ApiProperty({ enum: paidPlanNames, example: 'pro' })
  @IsIn(paidPlanNames)
  plan: string;
}

export class PortalDto {
  @ApiProperty({
    description: 'Bachs’s page to manage card, invoices and plan',
    example: 'https://portal.bachs.io/s/psn_123',
  })
  url: string;
}

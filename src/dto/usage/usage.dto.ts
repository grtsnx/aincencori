import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { billingPlanNames } from '@/config/billing/plans.js';

export class UsageDayDto {
  @ApiProperty({ example: '2026-11-13' })
  day: string;

  @ApiProperty({
    description:
      'chat, routine, plan, group, voice, computer, search, page-read, learning or review',
    example: 'chat',
  })
  kind: string;

  @ApiProperty({ description: 'Model calls', example: 12 })
  calls: number;

  @ApiProperty({ example: 18250 })
  inputTokens: number;

  @ApiProperty({ example: 2310 })
  outputTokens: number;

  @ApiProperty({ description: 'US dollars', example: 0.0421 })
  costUsd: number;
}

export class UsageDto {
  @ApiProperty({ enum: billingPlanNames, example: 'free' })
  plan: string;

  @ApiProperty({ description: 'AI allowance a month, USD', example: 2 })
  monthlyLimitUsd: number;

  @ApiProperty({ description: 'Used this month, USD', example: 0.4213 })
  usedUsd: number;

  @ApiProperty({ description: 'Left this month, USD', example: 1.5787 })
  remainingUsd: number;

  @ApiProperty({
    description: 'Bought AI credits left, USD (used after the allowance)',
    example: 8,
  })
  creditUsd: number;

  @ApiProperty({ example: 1240 })
  calls: number;

  @ApiProperty({ example: 182500 })
  inputTokens: number;

  @ApiProperty({ example: 23100 })
  outputTokens: number;

  @ApiProperty({
    description: 'When the allowance starts again',
    example: '2026-12-01T00:00:00.000Z',
  })
  renewsAt: Date;

  @ApiProperty({ type: [UsageDayDto], description: 'This month, by day' })
  days: UsageDayDto[];
}

export class UsageUserDto {
  @ApiProperty({ example: '3f9aB2xY-7aae-4ca4-86fd-933f1a45603f' })
  userId: string;

  @ApiProperty({ example: 'ada@example.com' })
  email: string;

  @ApiProperty({ example: 'free' })
  plan: string;

  @ApiProperty({ example: 1.25 })
  usedUsd: number;

  @ApiProperty({ example: 2 })
  monthlyLimitUsd: number;
}

export class UsageOverviewDto {
  @ApiProperty({ description: 'All users this month, USD', example: 41.2 })
  usedUsd: number;

  @ApiProperty({ example: 52000 })
  calls: number;

  @ApiProperty({ example: 312 })
  activeUsers: number;

  @ApiProperty({ type: [UsageUserDto], description: 'Biggest users first' })
  topUsers: UsageUserDto[];
}

export class SetBillingPlanDto {
  @ApiProperty({ enum: billingPlanNames, example: 'pro' })
  @IsIn(billingPlanNames)
  plan: string;

  @ApiPropertyOptional({
    description: 'A different monthly allowance in USD. Null: the plan’s own',
    example: 50,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100_000)
  monthlyLimitUsd?: number | null;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { billingCurrencies, listingPriceUsd } from '@/config/billing/plans.js';
import { listingCategories } from '@/config/agents/limits.js';

export class PublishBotDto {
  @ApiProperty({
    description: 'The bot to share. It needs a description',
    example: '3f9aB2xY-7aae-4ca4-86fd-933f1a45603f',
  })
  @IsString()
  @MaxLength(200)
  botId: string;

  @ApiProperty({ enum: listingCategories, example: 'sales' })
  @IsIn(listingCategories)
  category: string;

  @ApiPropertyOptional({
    description: 'The name shown as the author. Default: your name',
    example: 'Ada at Acme',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  authorName?: string;

  @ApiPropertyOptional({
    enum: ['free', 'one_off', 'monthly'],
    description: 'free; one_off: pay once; monthly: pay for each 30 days',
    default: 'free',
    example: 'monthly',
  })
  @IsOptional()
  @IsIn(['free', 'one_off', 'monthly'])
  priceType?: 'free' | 'one_off' | 'monthly';

  @ApiPropertyOptional({
    description: `Price in US dollars (${listingPriceUsd.min} to ${listingPriceUsd.max}); needed when paid`,
    example: 15,
  })
  @ValidateIf((dto: PublishBotDto) => (dto.priceType ?? 'free') !== 'free')
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(listingPriceUsd.min)
  @Max(listingPriceUsd.max)
  priceUsd?: number;
}

export class BrowseListingsQueryDto {
  @ApiPropertyOptional({
    description: 'Words to look for in the name or description',
    example: 'email',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: listingCategories, example: 'sales' })
  @IsOptional()
  @IsIn(listingCategories)
  category?: string;

  @ApiPropertyOptional({
    enum: ['popular', 'newest'],
    default: 'popular',
    example: 'popular',
  })
  @IsOptional()
  @IsIn(['popular', 'newest'])
  sort?: 'popular' | 'newest';

  @ApiPropertyOptional({ default: 24, minimum: 1, maximum: 100, example: 24 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'How many to skip, for the next page',
    default: 0,
    minimum: 0,
    maximum: 1000,
    example: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  offset?: number;
}

export class ReviewListingsQueryDto {
  @ApiPropertyOptional({
    enum: ['reviewing', 'published', 'rejected'],
    default: 'reviewing',
    example: 'reviewing',
  })
  @IsOptional()
  @IsIn(['reviewing', 'published', 'rejected'])
  status?: 'reviewing' | 'published' | 'rejected';

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100, example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'To load the next page, send the id of the last item you got',
    example: '7d0ad96f-7aae-4ca4-86fd-933f1a45603f',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  before?: string;
}

export class RejectListingDto {
  @ApiProperty({
    description: 'Why, shown to the author',
    example: 'The instructions ask the bot to collect card numbers.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;
}

export class ListingSkillDto {
  @ApiProperty({ example: 'follow-up-email' })
  name: string;

  @ApiProperty({ example: 'Write a follow-up email after a sales call.' })
  description: string;

  @ApiProperty({
    example: '1. Thank them for the call.\n2. Ask for a next meeting.',
  })
  instructions: string;
}

export class ListingDto {
  @ApiProperty({ example: '7d0ad96f-7aae-4ca4-86fd-933f1a45603f' })
  id: string;

  @ApiProperty({ example: 'Sales Bot' })
  name: string;

  @ApiProperty({ example: 'Answers sales emails and follows up with leads.' })
  description: string;

  @ApiProperty({ enum: listingCategories, example: 'sales' })
  category: string;

  @ApiProperty({ example: 'Ada at Acme' })
  authorName: string;

  @ApiProperty({
    description: 'What a copy of the bot is told to do',
    example: 'You help me answer sales emails. Be short and friendly.',
  })
  instructions: string;

  @ApiProperty({ type: [ListingSkillDto] })
  skills: ListingSkillDto[];

  @ApiProperty({ description: 'How many people copied it', example: 128 })
  importCount: number;

  @ApiProperty({
    enum: ['free', 'one_off', 'monthly'],
    example: 'monthly',
  })
  priceType: string;

  @ApiProperty({
    description: 'US dollars; null when free',
    example: 15,
    nullable: true,
  })
  priceUsd: number | null;

  @ApiProperty({ description: 'How many people hired it', example: 12 })
  hireCount: number;

  @ApiProperty({
    description: 'Paid: instructions and skill steps show once hired',
    example: true,
  })
  locked: boolean;

  @ApiProperty({
    type: Date,
    nullable: true,
    example: '2026-11-13T09:30:00.000Z',
  })
  publishedAt: Date | null;
}

export class OwnListingDto extends ListingDto {
  @ApiProperty({ example: '3f9aB2xY-7aae-4ca4-86fd-933f1a45603f' })
  botId: string;

  @ApiProperty({
    description: 'reviewing, published or rejected',
    example: 'published',
  })
  status: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Why it was rejected',
    example: 'The instructions ask the bot to collect card numbers.',
  })
  reviewNote: string | null;

  @ApiProperty({ example: '2026-11-13T09:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-11-13T09:30:00.000Z' })
  updatedAt: Date;
}

export class StartPayoutsDto {
  @ApiProperty({
    description: 'Where you live: a 2-letter country code',
    example: 'NG',
  })
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Za-z]{2}$/)
  country: string;
}

export class PayoutStatusDto {
  @ApiProperty({ description: 'You started payout setup', example: true })
  connected: boolean;

  @ApiProperty({
    description: 'Bachs checked you; your share is paid out',
    example: false,
  })
  payoutsActive: boolean;

  @ApiProperty({
    description: 'Open to finish or update payout setup (about an hour)',
    example: 'https://connect.bachs.io/onboarding/alnk_123',
    nullable: true,
  })
  setupUrl: string | null;

  @ApiProperty({
    description: 'Our share of each sale, in percent',
    example: 20,
  })
  feePercent: number;
}

export class HireBotDto {
  @ApiPropertyOptional({
    enum: billingCurrencies,
    description: 'Leave out to pick from the country (Nigeria: NGN)',
    example: 'USD',
  })
  @IsOptional()
  @IsIn(billingCurrencies)
  currency?: 'USD' | 'NGN';
}

export class HireCheckoutDto {
  @ApiProperty({
    description: 'Send the buyer here to pay',
    example: 'https://checkout.bachs.io/c/chk_123',
  })
  url: string;

  @ApiProperty({ example: '2026-11-14T10:00:00.000Z' })
  expiresAt: string;

  @ApiProperty({ description: 'The price, in the currency below', example: 15 })
  price: number;

  @ApiProperty({ enum: billingCurrencies, example: 'USD' })
  currency: string;
}

export class HireDto {
  @ApiProperty({ example: '9c1d2e3f-7aae-4ca4-86fd-933f1a45603f' })
  id: string;

  @ApiProperty({ example: '7d0ad96f-7aae-4ca4-86fd-933f1a45603f' })
  listingId: string;

  @ApiProperty({ example: 'Sales Bot' })
  name: string;

  @ApiProperty({ enum: ['one_off', 'monthly'], example: 'monthly' })
  kind: string;

  @ApiProperty({ example: '15.00' })
  amount: string;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ description: 'Our share of it', example: '3.00' })
  platformFee: string;

  @ApiProperty({
    description: 'The buyer’s copy of the bot',
    example: '3f9aB2xY-7aae-4ca4-86fd-933f1a45603f',
    nullable: true,
  })
  botId: string | null;

  @ApiProperty({
    description: 'Monthly: when this payment runs out',
    example: '2026-12-14T09:00:00.000Z',
    nullable: true,
  })
  paidUntil: Date | null;

  @ApiProperty({ example: '2026-11-14T09:00:00.000Z' })
  createdAt: Date;
}

export class EarningsTotalDto {
  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ example: 12 })
  sales: number;

  @ApiProperty({ description: 'What buyers paid', example: '180.00' })
  gross: string;

  @ApiProperty({
    description: 'Your share (before Bachs payout fees)',
    example: '144.00',
  })
  yours: string;
}

export class EarningsDto {
  @ApiProperty({ type: [EarningsTotalDto], description: 'By currency' })
  totals: EarningsTotalDto[];

  @ApiProperty({ type: [HireDto], description: 'Latest sales first' })
  sales: HireDto[];
}

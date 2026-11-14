import { ApiProperty } from '@nestjs/swagger';

export class AlertDto {
  @ApiProperty({ example: '3f9aB2xY-7aae-4ca4-86fd-933f1a45603f' })
  id: string;

  @ApiProperty({
    description: 'Where it came from',
    example: 'web-search',
  })
  source: string;

  @ApiProperty({ example: 'Web search failed (Exa and SearXNG)' })
  title: string;

  @ApiProperty({
    description: 'The real error, for staff only',
    example: 'Exa answered 429: rate limit',
    nullable: true,
  })
  detail: string | null;

  @ApiProperty({ description: 'Times it happened', example: 3 })
  count: number;

  @ApiProperty({ example: '2026-11-14T09:00:00.000Z' })
  firstAt: Date;

  @ApiProperty({ example: '2026-11-14T09:08:00.000Z' })
  lastAt: Date;
}

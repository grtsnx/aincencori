import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class StartCallDto {
  @ApiPropertyOptional({
    description:
      'Talk to one of your bots. Leave out for the default assistant',
    example: '3f9aB2xY-7aae-4ca4-86fd-933f1a45603f',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  botId?: string;

  @ApiPropertyOptional({
    description: 'Talk to one of your groups of bots',
    example: '9c1ad96f-7aae-4ca4-86fd-933f1a45603f',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  groupId?: string;
}

export class StartDictationDto {
  @ApiPropertyOptional({
    description: 'The language you will speak, as a two-letter code',
    default: 'en',
    example: 'en',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z]{2}$/, { message: 'language must be a two-letter code' })
  language?: string;
}

export class VoiceCallDto {
  @ApiProperty({
    description: 'The LiveKit server to connect to',
    example: 'wss://agentic.livekit.cloud',
  })
  url: string;

  @ApiProperty({
    description: 'Give this to the LiveKit client to join. Good for 10 minutes',
    example: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJrcTNGOWFCMnhZN3BMbTFuIn0.c2lnbg',
  })
  token: string;

  @ApiProperty({ example: 'call-7d0ad96f-7aae-4ca4-86fd-933f1a45603f' })
  room: string;
}

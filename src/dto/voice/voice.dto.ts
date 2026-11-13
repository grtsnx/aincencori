import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class TranscribeDto {
  @ApiProperty({
    description:
      'The recording as a data URL (mp3, wav, webm, m4a, ogg), up to 10 MB',
    example: 'data:audio/webm;base64,GkXfo59ChoEBQveBAULygQRC84EI',
  })
  @IsString()
  @Matches(/^data:audio\/[\w.+-]+(;[\w=.+-]+)*;base64,/, {
    message: 'audio must be an audio data URL',
  })
  audio: string;

  @ApiPropertyOptional({
    description: 'The spoken language as a two-letter code, if known',
    example: 'en',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z]{2}$/, { message: 'language must be a two-letter code' })
  language?: string;
}

export class TranscriptDto {
  @ApiProperty({ example: 'Write a short sales email to Chidi.' })
  text: string;

  @ApiProperty({ type: String, nullable: true, example: 'en' })
  language: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Length of the recording in seconds',
    example: 3.4,
  })
  seconds: number | null;
}

export class SpeakDto {
  @ApiProperty({
    description: 'The text to read aloud, up to 4,000 characters',
    example: 'Here is the email I wrote for Chidi.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  text: string;

  @ApiPropertyOptional({
    description: 'A voice from "List voices". Leave out for the default',
    example: 'alloy',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  voice?: string;
}

export class VoiceListDto {
  @ApiProperty({ type: [String], example: ['alloy', 'echo', 'nova'] })
  voices: string[];

  @ApiProperty({ example: 'alloy' })
  defaultVoice: string;
}

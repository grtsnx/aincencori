import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { SpeakDto, TranscribeDto, TranscriptDto, VoiceListDto } from '@/dto';
import { VoiceService } from './voice.service.js';

// Speech costs money per call, so these are limited more tightly than the
// rest of the API: 20 a minute per person.
@Controller({ path: 'voice', version: '1' })
@ApiTags('Voice')
@ApiCookieAuth()
@ApiServiceUnavailableResponse({
  description: 'Voice is not available right now',
})
@Throttle({ default: { ttl: 60_000, limit: 20 } })
export class VoiceController {
  constructor(private readonly voiceService: VoiceService) {}

  @ApiOperation({
    summary: 'Turn speech into text',
    description: 'Turns a voice recording into text you can send to chat.',
  })
  @ApiOkResponse({ type: TranscriptDto })
  @Post('transcribe')
  @HttpCode(200)
  transcribe(@Body() body: TranscribeDto): Promise<TranscriptDto> {
    return this.voiceService.transcribe(body);
  }

  @ApiOperation({
    summary: 'Read text aloud',
    description: 'Returns an MP3 of the text, spoken in the chosen voice.',
  })
  @ApiProduces('audio/mpeg')
  @ApiOkResponse({
    description: 'The MP3 audio',
    content: {
      'audio/mpeg': {
        schema: { type: 'string', format: 'binary', example: '(MP3 audio)' },
      },
    },
  })
  @Post('speak')
  @HttpCode(200)
  async speak(
    @Body() body: SpeakDto,
    @Res() response: Response,
  ): Promise<void> {
    const { audio, contentType } = await this.voiceService.speak(body);
    response
      .status(200)
      .setHeader('Content-Type', contentType)
      .setHeader('Content-Length', audio.length)
      .setHeader('Cache-Control', 'no-store')
      .end(audio);
  }

  @ApiOperation({
    summary: 'List voices',
    description: 'Lists the voices that can read text aloud.',
  })
  @ApiOkResponse({ type: VoiceListDto })
  @Get('voices')
  voices(): Promise<VoiceListDto> {
    return this.voiceService.voices();
  }
}

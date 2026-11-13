import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { StartCallDto, StartDictationDto, VoiceCallDto } from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { CurrentSession } from '@/middleware';
import { VoiceService } from './voice.service.js';

@Controller({ path: 'voice', version: '1' })
@ApiTags('Voice')
@ApiCookieAuth()
export class VoiceController {
  constructor(private readonly voiceService: VoiceService) {}

  @ApiOperation({
    summary: 'Start a voice call',
    description: 'Returns a ticket to talk live with a bot.',
  })
  @ApiOkResponse({ type: VoiceCallDto })
  @ApiNotFoundResponse({ description: 'Bot or group not found' })
  @ApiServiceUnavailableResponse({ description: 'Voice calls are not set up' })
  // Calls cost money per minute: 10 new calls a minute per person at most.
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('call')
  @HttpCode(200)
  startCall(
    @CurrentSession() auth: AuthSession,
    @Body() body: StartCallDto,
  ): Promise<VoiceCallDto> {
    return this.voiceService.startCall(auth, body);
  }

  @ApiOperation({
    summary: 'Start voice typing',
    description: 'Returns a ticket to speak and see your words typed live.',
  })
  @ApiOkResponse({ type: VoiceCallDto })
  @ApiServiceUnavailableResponse({ description: 'Voice is not set up' })
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('dictate')
  @HttpCode(200)
  startDictation(
    @CurrentSession() auth: AuthSession,
    @Body() body: StartDictationDto,
  ): Promise<VoiceCallDto> {
    return this.voiceService.startDictation(auth, body);
  }
}

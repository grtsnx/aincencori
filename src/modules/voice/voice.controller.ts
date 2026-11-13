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
import { StartCallDto, VoiceCallDto } from '@/dto';
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
}

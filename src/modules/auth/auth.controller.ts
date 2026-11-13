import { Controller, Get } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SessionDto } from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { CurrentSession } from '@/middleware';
import { AuthService } from './auth.service.js';

// Sign-up, sign-in and sign-out are served by Better Auth under /v1/auth.
@Controller({ path: 'auth', version: '1' })
@ApiTags('Auth')
@ApiCookieAuth()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({
    summary: 'Current session',
    description: 'Returns the signed-in user and session expiry.',
  })
  @ApiOkResponse({ type: SessionDto })
  @Get('session')
  session(@CurrentSession() auth: AuthSession): SessionDto {
    return this.authService.toSessionDto(auth);
  }
}

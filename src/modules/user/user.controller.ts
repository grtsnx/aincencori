import { Controller, Get, Headers } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { IncomingHttpHeaders } from 'node:http';
import { LinkedAccountDto, UserProfileDto, UserSessionDto } from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { CurrentSession } from '@/middleware';
import { UserService } from './user.service.js';

@Controller({ path: 'user', version: '1' })
@ApiTags('User')
@ApiCookieAuth()
export class UserController {
  constructor(private readonly userService: UserService) {}

  @ApiOperation({ summary: 'My profile' })
  @ApiOkResponse({ type: UserProfileDto })
  @Get()
  profile(@CurrentSession() auth: AuthSession): UserProfileDto {
    return this.userService.profile(auth);
  }

  @ApiOperation({ summary: 'My sign-in methods' })
  @ApiOkResponse({ type: [LinkedAccountDto] })
  @Get('accounts')
  accounts(
    @Headers() headers: IncomingHttpHeaders,
  ): Promise<LinkedAccountDto[]> {
    return this.userService.accounts(headers);
  }

  @ApiOperation({ summary: 'My sessions' })
  @ApiOkResponse({ type: [UserSessionDto] })
  @Get('sessions')
  sessions(
    @Headers() headers: IncomingHttpHeaders,
    @CurrentSession() auth: AuthSession,
  ): Promise<UserSessionDto[]> {
    return this.userService.sessions(headers, auth);
  }
}

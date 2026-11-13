import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { IncomingHttpHeaders } from 'node:http';
import {
  BetterAuthService,
  type AuthSession,
} from '@/lib/better-auth/better-auth.service.js';
import { IS_OPTIONAL_AUTH, IS_PUBLIC } from '../decorators/auth.decorators.js';

// Every route needs a signed-in user unless it is marked @Public() or @OptionalAuth().
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly betterAuth: BetterAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ headers: IncomingHttpHeaders; auth?: AuthSession }>();
    const session = await this.betterAuth.getSession(request.headers);

    if (session) {
      request.auth = session;
      return true;
    }
    if (this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH, targets)) {
      return true;
    }
    throw new UnauthorizedException('Sign in to continue.');
  }
}

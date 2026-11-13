import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';

export const IS_PUBLIC = 'auth:public';
export const IS_OPTIONAL_AUTH = 'auth:optional';

// Anyone can call the route, signed in or not.
export const Public = () => SetMetadata(IS_PUBLIC, true);

// Signed-in users get their session; anonymous callers are let through.
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH, true);

// The signed-in user and session that AuthGuard attached to the request.
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthSession | undefined =>
    context.switchToHttp().getRequest<{ auth?: AuthSession }>().auth,
);

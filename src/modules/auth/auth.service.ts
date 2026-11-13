import { Injectable } from '@nestjs/common';
import type { SessionDto } from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';

@Injectable()
export class AuthService {
  // Only the fields the frontend needs; tokens and other internals stay out.
  toSessionDto({ user, session }: AuthSession): SessionDto {
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image ?? null,
      },
      session: { expiresAt: session.expiresAt },
    };
  }
}

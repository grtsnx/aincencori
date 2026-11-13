import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type Observable, tap } from 'rxjs';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { ActivityService } from '@/modules/activity/activity.service.js';

// Route endings that name what was done (POST /plans/:id/stop).
const actionWords = new Set([
  'stop',
  'resume',
  'import',
  'approve',
  'reject',
  'test',
  'connect',
  'release',
  'reply',
  'run',
]);

const verbs: Record<string, string> = {
  POST: 'created',
  PUT: 'set',
  PATCH: 'updated',
  DELETE: 'deleted',
};

// Paths left out: chat turns (each tool the AI ran is logged instead), and
// routes that only read.
const skipped = [/^chat(\/|$)/, /^mcp(\/|$)/, /^voice(\/|$)/];

// Logs every change a signed-in person makes through the API (bots, apps,
// documents, rules, staff actions...), once it has worked.
@Injectable()
export class ActivityInterceptor implements NestInterceptor {
  constructor(private readonly activity: ActivityService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<{
      method: string;
      route?: { path?: string };
      params?: Record<string, string>;
      auth?: AuthSession;
      ip?: string;
    }>();
    const verb = verbs[request.method];
    const route = request.route?.path?.replace(/^\/?v\d+\//, '') ?? '';
    if (!verb || !request.auth || skipped.some((path) => path.test(route))) {
      return next.handle();
    }
    const segments = route.split('/').filter(Boolean);
    const last = segments[segments.length - 1] ?? '';
    const named = request.method === 'POST' && actionWords.has(last);
    const resources = segments.filter((part) => !part.startsWith(':'));
    const action = named
      ? resources.join('.')
      : `${resources.join('.')}.${verb}`;
    const ids = Object.values(request.params ?? {}).join(' ');
    const staff = segments[0] === 'admin';
    const auth = request.auth;
    return next.handle().pipe(
      tap(() =>
        this.activity.log({
          // Staff actions are about the platform, not the staff member.
          userId: staff ? (request.params?.id ?? null) : auth.user.id,
          actor: staff ? `staff:${auth.user.id}` : 'user',
          action,
          target: ids || null,
          ip: request.ip,
        }),
      ),
    );
  }
}

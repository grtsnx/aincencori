import {
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  notificationKeepDays,
  notificationTypeNames,
  notificationTypes,
  type NotificationType,
} from '@/config/notifications/types.js';
import { purgeNotificationsJob } from '@/config/agents/jobs.js';
import type {
  ListNotificationsQueryDto,
  MarkReadDto,
  NotificationListDto,
  NotificationSettingInfoDto,
  RegisterDeviceDto,
  UpdateNotificationSettingsDto,
} from '@/dto';
import { BullmqService } from '@/lib/bullmq/bullmq.service.js';
import { EmailService } from '@/lib/email/email.service.js';
import { FirebaseService } from '@/lib/firebase/firebase.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { reportProblem } from '@/middleware';

type Owner = { user: { id: string } };

// What to tell the user.
export interface NotificationInput {
  title: string;
  body: string;
  // A path in the app, like /approvals.
  link?: string;
}

// Notifications for users: every one goes into the app's inbox (the bell),
// and is also emailed and pushed to their phones and browsers when they
// chose so for its type (each type has a sensible default). Sending never
// fails the work that raised it.
@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly firebase: FirebaseService,
    private readonly config: ConfigService,
    private readonly bullmq: BullmqService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.bullmq.handle(purgeNotificationsJob, () => this.purge());
    await this.bullmq
      .schedule(
        purgeNotificationsJob,
        'daily',
        { cron: '30 3 * * *', timezone: 'UTC' },
        {},
      )
      .catch(() => this.logger.warn('Notification clean-up not scheduled.'));
  }

  // Tells the user something. Never throws.
  notify(
    userId: string,
    type: NotificationType,
    input: NotificationInput,
    options: { email?: boolean } = {},
  ): void {
    void this.deliver(userId, type, input, options).catch((error: unknown) =>
      reportProblem('notifications', 'A notification was not delivered', error),
    );
  }

  async list(
    auth: Owner,
    query: ListNotificationsQueryDto,
  ): Promise<NotificationListDto> {
    const userId = auth.user.id;
    const db = this.prisma.db;
    const [items, unread] = await Promise.all([
      db.notification.findMany({
        where: { userId, ...(query.unreadOnly && { readAt: null }) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit ?? 30,
        ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
      }),
      db.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, unread };
  }

  // Marks some, or all, as read.
  async markRead(auth: Owner, body: MarkReadDto): Promise<NotificationListDto> {
    await this.prisma.db.notification.updateMany({
      where: {
        userId: auth.user.id,
        readAt: null,
        ...(body.ids && { id: { in: body.ids } }),
      },
      data: { readAt: new Date() },
    });
    return this.list(auth, {});
  }

  // Every type with the user's choice (or its default).
  async settings(auth: Owner): Promise<NotificationSettingInfoDto[]> {
    const rows = await this.prisma.db.notificationSetting.findMany({
      where: { userId: auth.user.id },
    });
    return notificationTypeNames.map((type) => {
      const row = rows.find((setting) => setting.type === type);
      const fallback = notificationTypes[type];
      return {
        type,
        label: fallback.label,
        email: row?.email ?? fallback.email,
        push: row?.push ?? fallback.push,
      };
    });
  }

  async updateSettings(
    auth: Owner,
    body: UpdateNotificationSettingsDto,
  ): Promise<NotificationSettingInfoDto[]> {
    const userId = auth.user.id;
    const db = this.prisma.db;
    await db.$transaction(
      body.settings.map((setting) =>
        db.notificationSetting.upsert({
          where: { userId_type: { userId, type: setting.type } },
          create: { userId, ...setting },
          update: { email: setting.email, push: setting.push },
        }),
      ),
    );
    return this.settings(auth);
  }

  // A phone or browser that should get pushes. The same token moves to
  // whoever signed in on it last.
  async registerDevice(auth: Owner, body: RegisterDeviceDto): Promise<void> {
    await this.prisma.db.pushDevice.upsert({
      where: { token: body.token },
      create: {
        token: body.token,
        userId: auth.user.id,
        platform: body.platform,
      },
      update: {
        userId: auth.user.id,
        platform: body.platform,
        lastSeenAt: new Date(),
      },
    });
  }

  async removeDevice(auth: Owner, token: string): Promise<void> {
    const { count } = await this.prisma.db.pushDevice.deleteMany({
      where: { token, userId: auth.user.id },
    });
    if (count === 0) throw new NotFoundException('Device not found.');
  }

  private async deliver(
    userId: string,
    type: NotificationType,
    input: NotificationInput,
    options: { email?: boolean } = {},
  ): Promise<void> {
    const db = this.prisma.db;
    await db.notification.create({
      data: {
        id: randomUUID(),
        userId,
        type,
        title: input.title.slice(0, 200),
        body: input.body.slice(0, 1000),
        link: input.link ?? null,
      },
    });
    const [setting, user] = await Promise.all([
      db.notificationSetting.findUnique({
        where: { userId_type: { userId, type } },
      }),
      db.user.findUnique({
        where: { id: userId },
        select: { email: true },
      }),
    ]);
    if (!user) return;
    const fallback = notificationTypes[type];
    const app = this.config.get<string>('APP_URL') ?? '';
    if (options.email !== false && (setting?.email ?? fallback.email)) {
      await this.email.enqueue('notification', user.email, {
        appName: this.config.get<string>('PLATFORM_NAME') ?? 'Agentic',
        title: input.title,
        body: input.body,
        link: `${app}${input.link ?? '/'}`,
      });
    }
    if ((setting?.push ?? fallback.push) && this.firebase.isConfigured) {
      const devices = await db.pushDevice.findMany({
        where: { userId },
        take: 10,
      });
      for (const device of devices) {
        const result = await this.firebase
          .push(device.token, {
            title: input.title,
            body: input.body,
            link: input.link ? `${app}${input.link}` : null,
          })
          .catch((error: unknown) => {
            reportProblem('push', 'A push notification failed', error);
            return 'failed' as const;
          });
        if (result === 'gone') {
          await db.pushDevice.deleteMany({ where: { token: device.token } });
        }
      }
    }
  }

  private async purge(): Promise<void> {
    await this.prisma.db.notification.deleteMany({
      where: {
        createdAt: {
          lt: new Date(Date.now() - notificationKeepDays * 24 * 60 * 60_000),
        },
      },
    });
  }
}

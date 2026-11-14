import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ListNotificationsQueryDto,
  MarkReadDto,
  NotificationListDto,
  NotificationSettingInfoDto,
  RegisterDeviceDto,
  UpdateNotificationSettingsDto,
} from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { CurrentSession } from '@/middleware';
import { NotificationService } from './notification.service.js';

@Controller({ path: 'notifications', version: '1' })
@ApiTags('Notifications')
@ApiCookieAuth()
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @ApiOperation({
    summary: 'List notifications',
    description: 'Your notifications, newest first, and how many are unread.',
  })
  @ApiOkResponse({ type: NotificationListDto })
  @Get()
  list(
    @CurrentSession() auth: AuthSession,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<NotificationListDto> {
    return this.notificationService.list(auth, query);
  }

  @ApiOperation({
    summary: 'Mark as read',
    description: 'Marks some notifications, or all of them, as read.',
  })
  @ApiOkResponse({ type: NotificationListDto })
  @Post('read')
  @HttpCode(200)
  markRead(
    @CurrentSession() auth: AuthSession,
    @Body() body: MarkReadDto,
  ): Promise<NotificationListDto> {
    return this.notificationService.markRead(auth, body);
  }

  @ApiOperation({
    summary: 'Get notification settings',
    description: 'For each kind: also by email, and pushed or not.',
  })
  @ApiOkResponse({ type: [NotificationSettingInfoDto] })
  @Get('settings')
  settings(
    @CurrentSession() auth: AuthSession,
  ): Promise<NotificationSettingInfoDto[]> {
    return this.notificationService.settings(auth);
  }

  @ApiOperation({
    summary: 'Change notification settings',
    description: 'Choose email and push for each kind of notification.',
  })
  @ApiOkResponse({ type: [NotificationSettingInfoDto] })
  @Put('settings')
  updateSettings(
    @CurrentSession() auth: AuthSession,
    @Body() body: UpdateNotificationSettingsDto,
  ): Promise<NotificationSettingInfoDto[]> {
    return this.notificationService.updateSettings(auth, body);
  }

  @ApiOperation({
    summary: 'Add a push device',
    description: 'Registers this phone or browser for push notifications.',
  })
  @ApiNoContentResponse({ description: 'Registered' })
  @Post('devices')
  @HttpCode(204)
  registerDevice(
    @CurrentSession() auth: AuthSession,
    @Body() body: RegisterDeviceDto,
  ): Promise<void> {
    return this.notificationService.registerDevice(auth, body);
  }

  @ApiOperation({
    summary: 'Remove a push device',
    description: 'Stops push notifications to this phone or browser.',
  })
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiNotFoundResponse({ description: 'Device not found' })
  @Delete('devices/:token')
  @HttpCode(204)
  removeDevice(
    @CurrentSession() auth: AuthSession,
    @Param('token') token: string,
  ): Promise<void> {
    return this.notificationService.removeDevice(auth, token);
  }
}

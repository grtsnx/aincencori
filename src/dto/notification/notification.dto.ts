import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { notificationTypeNames } from '@/config/notifications/types.js';

export class NotificationDto {
  @ApiProperty({ example: '9c1d2e3f-7aae-4ca4-86fd-933f1a45603f' })
  id: string;

  @ApiProperty({ enum: notificationTypeNames, example: 'approval' })
  type: string;

  @ApiProperty({ example: 'A step is waiting for you' })
  title: string;

  @ApiProperty({
    example: 'Your routine "Morning brief" wants to send an email.',
  })
  body: string;

  @ApiProperty({
    description: 'Where to go in the app',
    example: '/approvals',
    nullable: true,
  })
  link: string | null;

  @ApiProperty({
    example: '2026-11-14T09:05:00.000Z',
    nullable: true,
    description: 'Null: not read yet',
  })
  readAt: Date | null;

  @ApiProperty({ example: '2026-11-14T09:00:00.000Z' })
  createdAt: Date;
}

export class NotificationListDto {
  @ApiProperty({ type: [NotificationDto], description: 'Newest first' })
  items: NotificationDto[];

  @ApiProperty({ description: 'Not read yet (for the bell)', example: 3 })
  unread: number;
}

export class ListNotificationsQueryDto {
  @ApiPropertyOptional({
    description: 'Only ones not read yet',
    example: true,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  unreadOnly?: boolean;

  @ApiPropertyOptional({
    description: 'The last id of the page before',
    example: '9c1d2e3f-7aae-4ca4-86fd-933f1a45603f',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  before?: string;

  @ApiPropertyOptional({ example: 30, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class MarkReadDto {
  @ApiPropertyOptional({
    description: 'These ones. Leave out to mark all as read',
    example: ['9c1d2e3f-7aae-4ca4-86fd-933f1a45603f'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  ids?: string[];
}

export class NotificationSettingDto {
  @ApiProperty({ enum: notificationTypeNames, example: 'routine' })
  @IsIn(notificationTypeNames)
  type: string;

  @ApiProperty({ description: 'Also send it by email', example: false })
  @IsBoolean()
  email: boolean;

  @ApiProperty({
    description: 'Also push it to phones and browsers',
    example: true,
  })
  @IsBoolean()
  push: boolean;
}

export class NotificationSettingInfoDto extends NotificationSettingDto {
  @ApiProperty({ example: 'A routine ran, failed or stopped' })
  label: string;
}

export class UpdateNotificationSettingsDto {
  @ApiProperty({ type: [NotificationSettingDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => NotificationSettingDto)
  settings: NotificationSettingDto[];
}

export class RegisterDeviceDto {
  @ApiProperty({
    description: 'The Firebase Cloud Messaging token from the app',
    example: 'fcm_dGVzdC10b2tlbi1mb3ItZG9jcw',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(4096)
  token: string;

  @ApiProperty({ enum: ['android', 'ios', 'web'], example: 'web' })
  @IsIn(['android', 'ios', 'web'])
  platform: string;
}

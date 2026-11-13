import { ApiProperty } from '@nestjs/swagger';

export class UserProfileDto {
  @ApiProperty({ example: 'kq3F9aB2xY7pLm1n' })
  id: string;

  @ApiProperty({ example: 'Ada Lovelace' })
  name: string;

  @ApiProperty({ example: 'ada@example.com' })
  email: string;

  @ApiProperty({ example: true })
  emailVerified: boolean;

  @ApiProperty({ type: String, nullable: true, example: null })
  image: string | null;

  @ApiProperty({ example: 'user' })
  role: string;

  @ApiProperty({ example: false })
  twoFactorEnabled: boolean;

  @ApiProperty({ type: String, nullable: true, example: 'email-otp' })
  lastLoginMethod: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-13T09:30:00.000Z',
  })
  createdAt: Date;
}

export class LinkedAccountDto {
  @ApiProperty({ example: 'acc_2Wq8Lp5N' })
  id: string;

  @ApiProperty({
    description: 'How the user signs in with this account',
    example: 'google',
  })
  providerId: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-13T09:30:00.000Z',
  })
  createdAt: Date;
}

export class UserSessionDto {
  @ApiProperty({ example: 'ses_6Jd1Xr4T' })
  id: string;

  @ApiProperty({ type: String, nullable: true, example: '203.0.113.7' })
  ipAddress: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6)',
  })
  userAgent: string | null;

  @ApiProperty({
    description: 'The session making this request',
    example: true,
  })
  current: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-13T09:30:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-20T09:30:00.000Z',
  })
  expiresAt: Date;
}

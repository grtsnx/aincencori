import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListUsersQueryDto {
  @ApiPropertyOptional({
    description: 'Part of a name or email',
    example: 'ada@example.com',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100, example: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ default: 0, minimum: 0, example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class AdminUserDto {
  @ApiProperty({ example: 'kq3F9aB2xY7pLm1n' })
  id: string;

  @ApiProperty({ example: 'Ada Lovelace' })
  name: string;

  @ApiProperty({ example: 'ada@example.com' })
  email: string;

  @ApiProperty({ example: true })
  emailVerified: boolean;

  @ApiProperty({ example: 'user' })
  role: string;

  @ApiProperty({ example: false })
  banned: boolean;

  @ApiProperty({ type: String, nullable: true, example: 'email-otp' })
  lastLoginMethod: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-13T09:30:00.000Z',
  })
  createdAt: Date;
}

export class UserListDto {
  @ApiProperty({ type: [AdminUserDto] })
  users: AdminUserDto[];

  @ApiProperty({ example: 1 })
  total: number;
}

const samplePermissions = {
  user: ['list', 'get', 'ban'],
  session: ['list', 'revoke'],
};

export class StaffUserDto {
  @ApiProperty({ example: 'kq3F9aB2xY7pLm1n' })
  id: string;

  @ApiProperty({ example: 'Grace Hopper' })
  name: string;

  @ApiProperty({ example: 'grace@example.com' })
  email: string;
}

export class StaffMemberDto {
  @ApiProperty({ example: 'mem_4Lx9QwE2' })
  id: string;

  @ApiProperty({ example: 'support-agent' })
  role: string;

  @ApiProperty({ type: StaffUserDto })
  user: StaffUserDto;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-13T09:30:00.000Z',
  })
  createdAt: Date;
}

export class InviteStaffDto {
  @ApiProperty({ example: 'grace@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'A built-in role (owner, admin, member) or a custom role',
    example: 'support-agent',
  })
  @IsString()
  @MaxLength(64)
  role: string;
}

export class StaffInvitationDto {
  @ApiProperty({ example: 'inv_9Tz3Kp8W' })
  id: string;

  @ApiProperty({ example: 'grace@example.com' })
  email: string;

  @ApiProperty({ type: String, nullable: true, example: 'support-agent' })
  role: string | null;

  @ApiProperty({ example: 'pending' })
  status: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-20T09:30:00.000Z',
  })
  expiresAt: Date;
}

export class UpdateStaffRoleDto {
  @ApiProperty({ example: 'support-agent' })
  @IsString()
  @MaxLength(64)
  role: string;
}

export class RoleDto {
  @ApiProperty({ type: String, nullable: true, example: 'role_5Vb2Nq8R' })
  id: string | null;

  @ApiProperty({ example: 'support-agent' })
  name: string;

  @ApiProperty({
    description: 'Allowed actions by resource',
    example: samplePermissions,
  })
  permissions: Record<string, string[]>;

  @ApiProperty({
    description: 'Built-in roles cannot be changed',
    example: false,
  })
  builtIn: boolean;
}

export class CreateRoleDto {
  @ApiProperty({
    description: 'Lowercase letters, numbers and dashes',
    example: 'support-agent',
  })
  @Matches(/^[a-z0-9-]{2,40}$/)
  name: string;

  @ApiProperty({
    description: 'Allowed actions by resource, from GET permissions',
    example: samplePermissions,
  })
  @IsObject()
  permissions: Record<string, string[]>;
}

export class UpdateRoleDto {
  @ApiProperty({ example: samplePermissions })
  @IsObject()
  permissions: Record<string, string[]>;
}

export class PermissionCatalogDto {
  @ApiProperty({
    description: 'Every action a role can be given, by resource',
    example: {
      user: ['list', 'get', 'update', 'ban', 'impersonate', 'delete'],
      session: ['list', 'revoke'],
      staff: ['invite', 'list', 'update', 'remove'],
      member: ['create', 'update', 'delete'],
      invitation: ['create', 'cancel'],
      team: ['create', 'update', 'delete'],
      ac: ['create', 'read', 'update', 'delete'],
      organization: ['update', 'delete'],
    },
  })
  permissions: Record<string, string[]>;
}

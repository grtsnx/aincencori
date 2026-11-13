import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListUsersQueryDto {
  @ApiPropertyOptional({ description: 'Part of a name or email' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class AdminUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  emailVerified: boolean;

  @ApiProperty({ example: 'user' })
  role: string;

  @ApiProperty()
  banned: boolean;

  @ApiProperty({ type: String, nullable: true, example: 'email-otp' })
  lastLoginMethod: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

export class UserListDto {
  @ApiProperty({ type: [AdminUserDto] })
  users: AdminUserDto[];

  @ApiProperty({ example: 1 })
  total: number;
}

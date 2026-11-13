import { ApiProperty } from '@nestjs/swagger';

export class SessionUserDto {
  @ApiProperty({ example: 'kq3F9aB2xY7pLm1n' })
  id: string;

  @ApiProperty({ example: 'Ada Lovelace' })
  name: string;

  @ApiProperty({ example: 'ada@example.com' })
  email: string;

  @ApiProperty({ example: false })
  emailVerified: boolean;

  @ApiProperty({ type: String, nullable: true, example: null })
  image: string | null;
}

export class SessionInfoDto {
  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt: Date;
}

export class SessionDto {
  @ApiProperty({ type: SessionUserDto })
  user: SessionUserDto;

  @ApiProperty({ type: SessionInfoDto })
  session: SessionInfoDto;
}

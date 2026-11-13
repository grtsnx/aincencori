import { ApiProperty } from '@nestjs/swagger';

export class OrganizationDto {
  @ApiProperty({ example: 'org_8sK2pQ' })
  id: string;

  @ApiProperty({ example: 'Acme' })
  name: string;

  @ApiProperty({ example: 'acme' })
  slug: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  logo: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-13T09:30:00.000Z',
  })
  createdAt: Date;
}

export class MemberUserDto {
  @ApiProperty({ example: 'kq3F9aB2xY7pLm1n' })
  id: string;

  @ApiProperty({ example: 'Ada Lovelace' })
  name: string;

  @ApiProperty({ example: 'ada@example.com' })
  email: string;
}

export class MemberDto {
  @ApiProperty({ example: 'mem_4Lx9QwE2' })
  id: string;

  @ApiProperty({ example: 'owner' })
  role: string;

  @ApiProperty({ type: MemberUserDto })
  user: MemberUserDto;
}

export class TeamDto {
  @ApiProperty({ example: 'team_7Hc2Rm1P' })
  id: string;

  @ApiProperty({ example: 'Support' })
  name: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-13T09:30:00.000Z',
  })
  createdAt: Date;
}

export class InvitationDto {
  @ApiProperty({ example: 'inv_9Tz3Kp8W' })
  id: string;

  @ApiProperty({ example: 'grace@example.com' })
  email: string;

  @ApiProperty({ type: String, nullable: true, example: 'member' })
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

export class OrganizationDetailsDto extends OrganizationDto {
  @ApiProperty({ type: [MemberDto] })
  members: MemberDto[];

  @ApiProperty({ type: [TeamDto] })
  teams: TeamDto[];

  @ApiProperty({ type: [InvitationDto] })
  invitations: InvitationDto[];
}

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

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

export class MemberUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;
}

export class MemberDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'owner' })
  role: string;

  @ApiProperty({ type: MemberUserDto })
  user: MemberUserDto;
}

export class TeamDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Support' })
  name: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

export class InvitationDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ type: String, nullable: true, example: 'member' })
  role: string | null;

  @ApiProperty({ example: 'pending' })
  status: string;

  @ApiProperty({ type: String, format: 'date-time' })
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

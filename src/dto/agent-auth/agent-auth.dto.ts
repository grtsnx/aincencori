import { ApiProperty } from '@nestjs/swagger';

export class AgentCapabilityDto {
  @ApiProperty({ example: 'get_profile' })
  name: string;

  @ApiProperty({ example: "Read the user's name and email." })
  description: string;
}

export class AgentConfigurationDto {
  @ApiProperty({ example: 'http://localhost:3000/v1/auth' })
  issuer: string;

  @ApiProperty({ example: 'Agentic' })
  provider_name: string;

  @ApiProperty({ example: ['delegated'] })
  modes: string[];

  @ApiProperty({ example: ['device_authorization', 'ciba'] })
  approval_methods: string[];

  @ApiProperty({
    description: 'Absolute URLs of every Agent Auth endpoint',
    example: {
      register: 'http://localhost:3000/v1/auth/agent/register',
      capabilities: 'http://localhost:3000/v1/auth/capability/list',
      execute: 'http://localhost:3000/v1/auth/capability/execute',
    },
  })
  endpoints: Record<string, string>;
}

export class AgentInfoDto {
  @ApiProperty({ example: 'agt_3Nf8Wq1Z' })
  id: string;

  @ApiProperty({ example: 'Support assistant' })
  name: string;

  @ApiProperty({ example: 'delegated' })
  mode: string;

  @ApiProperty({ example: ['get_profile'] })
  capabilities: string[];
}

export class AgentUserDto {
  @ApiProperty({ example: 'kq3F9aB2xY7pLm1n' })
  id: string;

  @ApiProperty({ example: 'Ada Lovelace' })
  name: string;

  @ApiProperty({ example: 'ada@example.com' })
  email: string;
}

export class AgentSessionDto {
  @ApiProperty({ type: AgentInfoDto })
  agent: AgentInfoDto;

  @ApiProperty({ type: AgentUserDto })
  user: AgentUserDto;
}

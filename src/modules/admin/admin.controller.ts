import { Controller, Get, Headers, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { IncomingHttpHeaders } from 'node:http';
import { ListUsersQueryDto, UserListDto } from '@/dto';
import { AdminService } from './admin.service.js';

@Controller({ path: 'admin', version: '1' })
@ApiTags('Admin')
@ApiCookieAuth()
@ApiForbiddenResponse({ description: 'The signed-in user is not an admin' })
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @ApiOperation({
    summary: 'List users',
    description: 'Admins only. Lists users with search and paging.',
  })
  @ApiOkResponse({ type: UserListDto })
  @Get('users')
  listUsers(
    @Headers() headers: IncomingHttpHeaders,
    @Query() query: ListUsersQueryDto,
  ): Promise<UserListDto> {
    return this.adminService.listUsers(headers, query);
  }
}

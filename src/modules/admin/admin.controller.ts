import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { IncomingHttpHeaders } from 'node:http';
import {
  CreateRoleDto,
  InviteStaffDto,
  ListUsersQueryDto,
  PermissionCatalogDto,
  RoleDto,
  StaffInvitationDto,
  StaffMemberDto,
  UpdateRoleDto,
  UpdateStaffRoleDto,
  UserListDto,
} from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { CurrentSession } from '@/middleware';
import { AdminService } from './admin.service.js';

@Controller({ path: 'admin', version: '1' })
@ApiTags('Admin')
@ApiCookieAuth()
@ApiForbiddenResponse({ description: 'Not allowed for this user' })
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

  @ApiOperation({
    summary: 'List staff',
    description: 'Lists platform staff and their roles.',
  })
  @ApiOkResponse({ type: [StaffMemberDto] })
  @Get('staff')
  listStaff(
    @CurrentSession() auth: AuthSession,
    @Headers() headers: IncomingHttpHeaders,
  ): Promise<StaffMemberDto[]> {
    return this.adminService.listStaff(auth, headers);
  }

  @ApiOperation({
    summary: 'Invite staff',
    description: 'Emails someone an invite to join the staff.',
  })
  @ApiOkResponse({ type: StaffInvitationDto })
  @Post('staff/invitations')
  @HttpCode(200)
  inviteStaff(
    @CurrentSession() auth: AuthSession,
    @Headers() headers: IncomingHttpHeaders,
    @Body() body: InviteStaffDto,
  ): Promise<StaffInvitationDto> {
    return this.adminService.inviteStaff(auth, headers, body);
  }

  @ApiOperation({
    summary: 'List staff invites',
    description: 'Lists staff invites and their status.',
  })
  @ApiOkResponse({ type: [StaffInvitationDto] })
  @Get('staff/invitations')
  listStaffInvitations(
    @CurrentSession() auth: AuthSession,
    @Headers() headers: IncomingHttpHeaders,
  ): Promise<StaffInvitationDto[]> {
    return this.adminService.listStaffInvitations(auth, headers);
  }

  @ApiOperation({
    summary: 'Change staff role',
    description: "Changes a staff member's role and permissions.",
  })
  @ApiOkResponse({ type: StaffMemberDto })
  @Patch('staff/:memberId/role')
  updateStaffRole(
    @CurrentSession() auth: AuthSession,
    @Headers() headers: IncomingHttpHeaders,
    @Param('memberId') memberId: string,
    @Body() body: UpdateStaffRoleDto,
  ): Promise<StaffMemberDto> {
    return this.adminService.updateStaffRole(
      auth,
      headers,
      memberId,
      body.role,
    );
  }

  @ApiOperation({
    summary: 'Remove staff',
    description: 'Removes someone from the staff.',
  })
  @ApiNoContentResponse({ description: 'Removed' })
  @Delete('staff/:memberId')
  @HttpCode(204)
  removeStaff(
    @CurrentSession() auth: AuthSession,
    @Headers() headers: IncomingHttpHeaders,
    @Param('memberId') memberId: string,
  ): Promise<void> {
    return this.adminService.removeStaff(auth, headers, memberId);
  }

  @ApiOperation({
    summary: 'List permissions',
    description: 'Every permission a role can be given.',
  })
  @ApiOkResponse({ type: PermissionCatalogDto })
  @Get('permissions')
  permissions(): PermissionCatalogDto {
    return this.adminService.permissions();
  }

  @ApiOperation({
    summary: 'List staff roles',
    description: 'Lists built-in and custom staff roles.',
  })
  @ApiOkResponse({ type: [RoleDto] })
  @Get('roles')
  listRoles(
    @CurrentSession() auth: AuthSession,
    @Headers() headers: IncomingHttpHeaders,
  ): Promise<RoleDto[]> {
    return this.adminService.listRoles(auth, headers);
  }

  @ApiOperation({
    summary: 'Create staff role',
    description: 'Creates a custom role with chosen permissions.',
  })
  @ApiOkResponse({ type: RoleDto })
  @Post('roles')
  @HttpCode(200)
  createRole(
    @CurrentSession() auth: AuthSession,
    @Headers() headers: IncomingHttpHeaders,
    @Body() body: CreateRoleDto,
  ): Promise<RoleDto> {
    return this.adminService.createRole(auth, headers, body);
  }

  @ApiOperation({
    summary: 'Update staff role',
    description: "Changes a custom role's permissions.",
  })
  @ApiOkResponse({ type: RoleDto })
  @Patch('roles/:roleId')
  updateRole(
    @CurrentSession() auth: AuthSession,
    @Headers() headers: IncomingHttpHeaders,
    @Param('roleId') roleId: string,
    @Body() body: UpdateRoleDto,
  ): Promise<RoleDto> {
    return this.adminService.updateRole(auth, headers, roleId, body);
  }

  @ApiOperation({
    summary: 'Delete staff role',
    description: 'Deletes a custom role no one uses.',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @Delete('roles/:roleId')
  @HttpCode(204)
  deleteRole(
    @CurrentSession() auth: AuthSession,
    @Headers() headers: IncomingHttpHeaders,
    @Param('roleId') roleId: string,
  ): Promise<void> {
    return this.adminService.deleteRole(auth, headers, roleId);
  }
}

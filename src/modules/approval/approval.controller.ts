import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  PendingApprovalDto,
  SetToolRuleDto,
  ToolInfoDto,
  ToolRuleDto,
} from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { CurrentSession } from '@/middleware';
import { ApprovalService } from './approval.service.js';

@Controller({ path: 'approvals', version: '1' })
@ApiTags('Approvals')
@ApiCookieAuth()
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  @ApiOperation({
    summary: 'List waiting approvals',
    description:
      'Steps your AI stopped at. Approve one by sending it to the chat.',
  })
  @ApiOkResponse({ type: [PendingApprovalDto] })
  @Get()
  inbox(@CurrentSession() auth: AuthSession): Promise<PendingApprovalDto[]> {
    return this.approvalService.inbox(auth);
  }

  @ApiOperation({
    summary: 'List risky tools',
    description: 'Tools that ask before they run, with what each does.',
  })
  @ApiOkResponse({ type: [ToolInfoDto] })
  @Get('tools')
  tools(): ToolInfoDto[] {
    return this.approvalService.tools();
  }

  @ApiOperation({
    summary: 'List my rules',
    description: 'Your standing answers: always allow, always ask, or never.',
  })
  @ApiOkResponse({ type: [ToolRuleDto] })
  @Get('rules')
  rules(@CurrentSession() auth: AuthSession): Promise<ToolRuleDto[]> {
    return this.approvalService.listRules(auth);
  }

  @ApiOperation({
    summary: 'Set a rule',
    description: 'Always allow, always ask, or never run a tool.',
  })
  @ApiOkResponse({ type: ToolRuleDto })
  @ApiNotFoundResponse({ description: 'Bot not found' })
  @Put('rules')
  @HttpCode(200)
  setRule(
    @CurrentSession() auth: AuthSession,
    @Body() body: SetToolRuleDto,
  ): Promise<ToolRuleDto> {
    return this.approvalService.setRule(auth, body);
  }

  @ApiOperation({
    summary: 'Remove a rule',
    description: 'The tool asks again before it runs.',
  })
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiNotFoundResponse({ description: 'Rule not found' })
  @Delete('rules/:id')
  @HttpCode(204)
  removeRule(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<void> {
    return this.approvalService.removeRule(auth, id);
  }

  @ApiOperation({
    summary: 'Dismiss an approval',
    description: 'Removes it from the inbox; the steps never run.',
  })
  @ApiNoContentResponse({ description: 'Dismissed' })
  @ApiNotFoundResponse({ description: 'Approval not found' })
  @Delete(':id')
  @HttpCode(204)
  dismiss(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<void> {
    return this.approvalService.dismiss(auth, id);
  }
}

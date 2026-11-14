import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiExcludeEndpoint,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AnswerApprovalDto,
  PendingApprovalDto,
  SetToolRuleDto,
  ToolInfoDto,
  ToolRuleDto,
} from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { CurrentSession, Public } from '@/middleware';
import { ApprovalService } from './approval.service.js';

@Controller({ path: 'approvals', version: '1' })
@ApiTags('Approvals')
@ApiCookieAuth()
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  @ApiOperation({
    summary: 'List waiting approvals',
    description: 'Steps your AI stopped at, waiting for your OK.',
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

  @ApiOperation({
    summary: 'Answer an app step',
    description: 'Yes or no to a waiting step in a connected app.',
  })
  @ApiNoContentResponse({ description: 'Answered' })
  @ApiBadRequestResponse({ description: 'Answer it in its chat' })
  @ApiNotFoundResponse({ description: 'Approval not found' })
  @ApiConflictResponse({ description: 'Already answered or expired' })
  @Post(':id/answer')
  @HttpCode(204)
  answer(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
    @Body() body: AnswerApprovalDto,
  ): Promise<void> {
    return this.approvalService.answer(auth, id, body);
  }

  // Cencori calls this when a connected-app step waits for approval. Not
  // for apps, so it is left out of the docs.
  @ApiExcludeEndpoint()
  @Public()
  @Post('cencori')
  @HttpCode(204)
  cencoriWebhook(
    @Req() request: Request,
    @Headers('x-webhook-signature') signature?: string,
  ): Promise<void> {
    return this.approvalService.cencoriWebhook(request.body, signature);
  }
}

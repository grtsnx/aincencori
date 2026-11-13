import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { IncomingHttpHeaders } from 'node:http';
import {
  BotDto,
  BrowseListingsQueryDto,
  ListingDto,
  OwnListingDto,
  PublishBotDto,
  RejectListingDto,
  ReviewListingsQueryDto,
} from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { CurrentSession, OptionalAuth, Public } from '@/middleware';
import { MarketplaceService } from './marketplace.service.js';

// Marketplace routes for everyone (/v1/marketplace), and its review routes
// for staff (/v1/admin/marketplace).
@Controller({ version: '1' })
@ApiExtraModels(ListingDto, OwnListingDto)
@ApiNotFoundResponse({ description: 'Bot not found on the marketplace' })
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @ApiTags('Marketplace')
  @ApiOperation({
    summary: 'Browse bots',
    description: 'Lists shared bots, most copied first. No sign-in needed.',
  })
  @ApiOkResponse({ type: [ListingDto] })
  @Public()
  @Get('marketplace')
  browse(@Query() query: BrowseListingsQueryDto): Promise<ListingDto[]> {
    return this.marketplaceService.browse(query);
  }

  @ApiTags('Marketplace')
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Share a bot',
    description: 'Shares a copy of your bot after a safety review.',
  })
  @ApiOkResponse({ type: OwnListingDto })
  @Post('marketplace')
  @HttpCode(200)
  publish(
    @CurrentSession() auth: AuthSession,
    @Body() body: PublishBotDto,
  ): Promise<OwnListingDto> {
    return this.marketplaceService.publish(auth, body);
  }

  @ApiTags('Marketplace')
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'List shared bots',
    description: 'Lists the bots you shared, with their review status.',
  })
  @ApiOkResponse({ type: [OwnListingDto] })
  @Get('marketplace/mine')
  mine(@CurrentSession() auth: AuthSession): Promise<OwnListingDto[]> {
    return this.marketplaceService.mine(auth);
  }

  @ApiTags('Marketplace')
  @ApiOperation({
    summary: 'Preview a bot',
    description: 'Shows what a shared bot does, and its skills.',
  })
  @ApiOkResponse({
    description: 'The bot. Its author also gets the review status',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(ListingDto) },
        { $ref: getSchemaPath(OwnListingDto) },
      ],
    },
  })
  @OptionalAuth()
  @Get('marketplace/:id')
  get(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession | undefined,
  ): Promise<ListingDto | OwnListingDto> {
    return this.marketplaceService.get(id, auth ?? null);
  }

  @ApiTags('Marketplace')
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Copy a bot',
    description: 'Adds your own copy of a shared bot to your bots.',
  })
  @ApiOkResponse({ type: BotDto })
  @Post('marketplace/:id/import')
  @HttpCode(200)
  import(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<BotDto> {
    return this.marketplaceService.import(id, auth);
  }

  @ApiTags('Marketplace')
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Stop sharing a bot',
    description: 'Takes your bot off the marketplace. Copies stay.',
  })
  @ApiNoContentResponse({ description: 'Removed' })
  @Delete('marketplace/:id')
  @HttpCode(204)
  unpublish(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<void> {
    return this.marketplaceService.unpublish(id, auth);
  }

  @ApiTags('Admin')
  @ApiCookieAuth()
  @ApiForbiddenResponse({ description: 'Not allowed for this user' })
  @ApiOperation({
    summary: 'Review shared bots',
    description: 'Lists marketplace bots by review status. Staff only.',
  })
  @ApiOkResponse({ type: [OwnListingDto] })
  @Get('admin/marketplace')
  reviewList(
    @CurrentSession() auth: AuthSession,
    @Headers() headers: IncomingHttpHeaders,
    @Query() query: ReviewListingsQueryDto,
  ): Promise<OwnListingDto[]> {
    return this.marketplaceService.reviewList(auth, headers, query);
  }

  @ApiTags('Admin')
  @ApiCookieAuth()
  @ApiForbiddenResponse({ description: 'Not allowed for this user' })
  @ApiOperation({
    summary: 'Approve a bot',
    description: 'Publishes a shared bot on the marketplace. Staff only.',
  })
  @ApiOkResponse({ type: OwnListingDto })
  @Post('admin/marketplace/:id/approve')
  @HttpCode(200)
  approve(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
    @Headers() headers: IncomingHttpHeaders,
  ): Promise<OwnListingDto> {
    return this.marketplaceService.approve(id, auth, headers);
  }

  @ApiTags('Admin')
  @ApiCookieAuth()
  @ApiForbiddenResponse({ description: 'Not allowed for this user' })
  @ApiOperation({
    summary: 'Reject a bot',
    description: 'Hides a shared bot and tells the author why. Staff only.',
  })
  @ApiOkResponse({ type: OwnListingDto })
  @Post('admin/marketplace/:id/reject')
  @HttpCode(200)
  reject(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
    @Headers() headers: IncomingHttpHeaders,
    @Body() body: RejectListingDto,
  ): Promise<OwnListingDto> {
    return this.marketplaceService.reject(id, body.reason, auth, headers);
  }
}

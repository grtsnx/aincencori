import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiExcludeEndpoint,
  ApiNotFoundResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import {
  BillingDto,
  BuyCreditsDto,
  CheckoutDto,
  PortalDto,
  PriceListDto,
  PriceListQueryDto,
  StartCheckoutDto,
  StartTrialDto,
} from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { CurrentSession, Public } from '@/middleware';
import { BillingService } from './billing.service.js';

@Controller({ path: 'billing', version: '1' })
@ApiTags('Billing')
@ApiCookieAuth()
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @ApiOperation({
    summary: 'List prices',
    description: 'Plans and credit packs, in naira or dollars by country.',
  })
  @ApiOkResponse({ type: PriceListDto })
  @Public()
  @Get('plans')
  prices(
    @Headers() headers: IncomingHttpHeaders,
    @Query() query: PriceListQueryDto,
  ): PriceListDto {
    return this.billingService.prices(headers, query.currency);
  }

  @ApiOperation({
    summary: 'Get my billing',
    description: 'Your plan, how it is paid, when it ends, and credits.',
  })
  @ApiOkResponse({ type: BillingDto })
  @Get()
  mine(@CurrentSession() auth: AuthSession): Promise<BillingDto> {
    return this.billingService.mine(auth);
  }

  @ApiOperation({
    summary: 'Start a free trial',
    description: 'Try a paid plan free for 7 days, once.',
  })
  @ApiOkResponse({ type: BillingDto })
  @ApiConflictResponse({ description: 'Trial used, or already paid' })
  @Post('trial')
  @HttpCode(200)
  trial(
    @CurrentSession() auth: AuthSession,
    @Body() body: StartTrialDto,
  ): Promise<BillingDto> {
    return this.billingService.startTrial(auth, body);
  }

  @ApiOperation({
    summary: 'Pay for a plan',
    description: 'A Bachs checkout page: dollars renew, naira pays a month.',
  })
  @ApiOkResponse({ type: CheckoutDto })
  @ApiConflictResponse({ description: 'Already paying by card' })
  @ApiServiceUnavailableResponse({ description: 'Payments not set up' })
  @Post('checkout')
  @HttpCode(200)
  checkout(
    @CurrentSession() auth: AuthSession,
    @Headers() headers: IncomingHttpHeaders,
    @Body() body: StartCheckoutDto,
  ): Promise<CheckoutDto> {
    return this.billingService.checkout(auth, headers, body);
  }

  @ApiOperation({
    summary: 'Buy AI credits',
    description: 'A checkout page for extra AI credits that never expire.',
  })
  @ApiOkResponse({ type: CheckoutDto })
  @ApiServiceUnavailableResponse({ description: 'Payments not set up' })
  @Post('credits')
  @HttpCode(200)
  credits(
    @CurrentSession() auth: AuthSession,
    @Headers() headers: IncomingHttpHeaders,
    @Body() body: BuyCreditsDto,
  ): Promise<CheckoutDto> {
    return this.billingService.buyCredits(auth, headers, body);
  }

  @ApiOperation({
    summary: 'Open customer portal',
    description: 'A link to manage your card, invoices and plan.',
  })
  @ApiOkResponse({ type: PortalDto })
  @ApiNotFoundResponse({ description: 'Nothing paid yet' })
  @Post('portal')
  @HttpCode(200)
  portal(@CurrentSession() auth: AuthSession): Promise<PortalDto> {
    return this.billingService.portal(auth);
  }

  @ApiOperation({
    summary: 'Cancel my card plan',
    description: 'It stops renewing and ends with the paid month.',
  })
  @ApiOkResponse({ type: BillingDto })
  @ApiBadRequestResponse({ description: 'Not a card plan' })
  @Post('cancel')
  @HttpCode(200)
  cancel(@CurrentSession() auth: AuthSession): Promise<BillingDto> {
    return this.billingService.cancel(auth);
  }

  // Bachs calls this about payments. Not for apps, so left out of the docs.
  @ApiExcludeEndpoint()
  @ApiNoContentResponse()
  @Public()
  @Post('bachs')
  @HttpCode(204)
  webhook(@Req() request: Request): Promise<void> {
    return this.billingService.webhook(request.body, request.headers);
  }
}

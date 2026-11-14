import { Controller, Delete, Get, HttpCode, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ComputerDto, ComputerFilesDto, ComputerFilesQueryDto } from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { CurrentSession } from '@/middleware';
import { ComputerService } from './computer.service.js';

@Controller({ path: 'computer', version: '1' })
@ApiTags('Computer')
@ApiCookieAuth()
export class ComputerController {
  constructor(private readonly computerService: ComputerService) {}

  @ApiOperation({
    summary: 'Get my computer',
    description: 'Whether your agents have their own cloud computer yet.',
  })
  @ApiOkResponse({ type: ComputerDto })
  @Get()
  status(@CurrentSession() auth: AuthSession): Promise<ComputerDto> {
    return this.computerService.status(auth);
  }

  @ApiOperation({
    summary: 'Browse computer files',
    description: 'Lists a folder, or reads a text file, on your computer.',
  })
  @ApiOkResponse({ type: ComputerFilesDto })
  @ApiNotFoundResponse({ description: 'No computer, or no such file' })
  @Get('files')
  files(
    @CurrentSession() auth: AuthSession,
    @Query() query: ComputerFilesQueryDto,
  ): Promise<ComputerFilesDto> {
    return this.computerService.files(auth, query.path);
  }

  @ApiOperation({
    summary: 'Wipe my computer',
    description: 'Deletes the computer and its files. A fresh one comes later.',
  })
  @ApiNoContentResponse({ description: 'Wiped' })
  @Delete()
  @HttpCode(204)
  reset(@CurrentSession() auth: AuthSession): Promise<void> {
    return this.computerService.reset(auth);
  }
}

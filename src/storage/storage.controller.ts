import {
  Controller,
  Get,
  NotFoundException,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import { basename } from 'path';
import { Public } from '../auth/decorators/public.decorator';
import { StorageService } from './storage.service';

@ApiTags('Storage')
@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Get('local')
  @Public()
  @ApiOperation({
    summary: 'Download a file stored on the local filesystem (development only)',
  })
  downloadLocal(@Query('token') token: string, @Res() res: Response) {
    if (this.storageService.getDriver() !== 'local') {
      throw new NotFoundException('Local storage is not enabled');
    }

    if (!token) {
      throw new NotFoundException('Download token is required');
    }

    const storagePath = this.storageService.verifyLocalDownloadToken(token);
    const filePath = this.storageService.resolveLocalPath(storagePath);

    if (!existsSync(filePath)) {
      throw new NotFoundException('File not found');
    }

    res.setHeader(
      'Content-Disposition',
      `inline; filename="${basename(storagePath)}"`,
    );
    createReadStream(filePath).pipe(res);
  }
}

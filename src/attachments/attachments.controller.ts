import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/auth.interface';
import { MAX_ATTACHMENT_SIZE_BYTES } from './utils/attachment.util';
import { AttachmentsService } from './attachments.service';
import { AttachmentQueryDto } from './dto/attachment-query.dto';
import {
  AttachmentDownloadResponseDto,
  AttachmentResponseDto,
  PaginatedAttachmentsResponseDto,
} from './dto/attachment-response.dto';

@ApiTags('Ticket Attachments')
@ApiBearerAuth()
@Controller('tickets/:ticketId/attachments')
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Get()
  @ApiOperation({ summary: 'List attachments on a ticket' })
  findAll(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Query() query: AttachmentQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<PaginatedAttachmentsResponseDto> {
    return this.attachmentsService.findAll(ticketId, query, currentUser);
  }

  @Post()
  @ApiOperation({ summary: 'Upload an attachment' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_ATTACHMENT_SIZE_BYTES },
    }),
  )
  upload(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<AttachmentResponseDto> {
    return this.attachmentsService.upload(ticketId, file, currentUser);
  }

  @Get(':attachmentId/download-url')
  @ApiOperation({ summary: 'Get a signed download URL for an attachment' })
  getDownloadUrl(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<AttachmentDownloadResponseDto> {
    return this.attachmentsService.getDownloadUrl(
      ticketId,
      attachmentId,
      currentUser,
    );
  }

  @Delete(':attachmentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an attachment' })
  remove(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ message: string }> {
    return this.attachmentsService.remove(ticketId, attachmentId, currentUser);
  }
}

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RoleType } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  buildPaginatedResult,
  PaginatedResult,
} from '../common/dto/pagination.dto';
import { AuthenticatedUser } from '../auth/interfaces/auth.interface';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  TicketAccessContext,
} from '../tickets/ticket-workflow';
import { assertTicketVisibleToUser } from '../tickets/ticket-scope.util';
import { AttachmentQueryDto } from './dto/attachment-query.dto';
import {
  AttachmentDownloadResponseDto,
  AttachmentResponseDto,
  AttachmentUserDto,
} from './dto/attachment-response.dto';
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  ALLOWED_IMAGE_MIME_TYPES,
  buildAttachmentStoragePath,
  MAX_ATTACHMENT_SIZE_BYTES,
  sanitizeFileName,
} from './utils/attachment.util';

type AttachmentWithUser = Prisma.TicketAttachmentGetPayload<{
  include: { uploadedBy: { include: { role: true } } };
}>;

const userInclude = { role: true } as const;

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async findAll(
    ticketId: string,
    query: AttachmentQueryDto,
    currentUser: AuthenticatedUser,
  ): Promise<PaginatedResult<AttachmentResponseDto>> {
    const ticket = await this.getTicketAccessContext(ticketId);
    await assertTicketVisibleToUser(this.prisma, currentUser, ticket);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.TicketAttachmentWhereInput = {
      ticketId,
      deletedAt: null,
    };

    const [attachments, total] = await this.prisma.$transaction([
      this.prisma.ticketAttachment.findMany({
        where,
        include: { uploadedBy: { include: userInclude } },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.ticketAttachment.count({ where }),
    ]);

    return buildPaginatedResult(
      attachments.map((attachment) => this.mapAttachment(attachment)),
      total,
      page,
      limit,
    );
  }

  async upload(
    ticketId: string,
    file: Express.Multer.File,
    currentUser: AuthenticatedUser,
  ): Promise<AttachmentResponseDto> {
    const ticket = await this.getTicketForUpload(ticketId);
    await assertTicketVisibleToUser(this.prisma, currentUser, ticket);

    this.validateFile(file, currentUser.role);

    const attachmentId = randomUUID();
    const safeFileName = sanitizeFileName(file.originalname);
    const storagePath = buildAttachmentStoragePath(
      ticket.project.code,
      ticket.sprintId,
      ticketId,
      attachmentId,
      safeFileName,
    );

    await this.storageService.upload(storagePath, file.buffer, file.mimetype);

    try {
      const attachment = await this.prisma.$transaction(async (tx) => {
        const created = await tx.ticketAttachment.create({
          data: {
            id: attachmentId,
            ticketId,
            uploadedById: currentUser.id,
            fileName: file.originalname,
            filePath: storagePath,
            fileSize: file.size,
            mimeType: file.mimetype,
          },
          include: { uploadedBy: { include: userInclude } },
        });

        await tx.ticketHistory.create({
          data: {
            ticketId,
            userId: currentUser.id,
            action: 'ATTACHMENT_ADDED',
            metadata: {
              attachmentId: created.id,
              fileName: created.fileName,
            },
          },
        });

        return created;
      });

      return this.mapAttachment(attachment);
    } catch (error) {
      await this.storageService.remove(storagePath).catch(() => undefined);
      throw error;
    }
  }

  async getDownloadUrl(
    ticketId: string,
    attachmentId: string,
    currentUser: AuthenticatedUser,
  ): Promise<AttachmentDownloadResponseDto> {
    const ticket = await this.getTicketAccessContext(ticketId);
    await assertTicketVisibleToUser(this.prisma, currentUser, ticket);

    const attachment = await this.findAttachmentOrThrow(ticketId, attachmentId);
    const expiresIn = 3600;
    const url = await this.storageService.getSignedUrl(
      attachment.filePath,
      expiresIn,
    );

    return {
      url,
      expiresIn,
      fileName: attachment.fileName,
    };
  }

  async remove(
    ticketId: string,
    attachmentId: string,
    currentUser: AuthenticatedUser,
  ): Promise<{ message: string }> {
    const ticket = await this.getTicketAccessContext(ticketId);
    await assertTicketVisibleToUser(this.prisma, currentUser, ticket);

    const attachment = await this.findAttachmentOrThrow(ticketId, attachmentId);

    if (
      attachment.uploadedById !== currentUser.id &&
      currentUser.role !== RoleType.ADMIN
    ) {
      throw new ForbiddenException('You can only delete your own attachments');
    }

    await this.prisma.$transaction([
      this.prisma.ticketAttachment.update({
        where: { id: attachmentId },
        data: { deletedAt: new Date() },
      }),
      this.prisma.ticketHistory.create({
        data: {
          ticketId,
          userId: currentUser.id,
          action: 'ATTACHMENT_DELETED',
          metadata: {
            attachmentId,
            fileName: attachment.fileName,
          },
        },
      }),
    ]);

    await this.storageService.remove(attachment.filePath).catch(() => undefined);

    return { message: 'Attachment deleted successfully' };
  }

  private validateFile(file: Express.Multer.File, role: RoleType): void {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      throw new BadRequestException('File size exceeds the 10 MB limit');
    }

    const allowedTypes =
      role === RoleType.USER
        ? ALLOWED_IMAGE_MIME_TYPES
        : ALLOWED_ATTACHMENT_MIME_TYPES;

    if (!allowedTypes.has(file.mimetype)) {
      throw new BadRequestException(
        role === RoleType.USER
          ? 'Only image files are allowed'
          : 'File type is not allowed',
      );
    }
  }

  private async getTicketForUpload(ticketId: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, deletedAt: null },
      select: {
        id: true,
        status: true,
        createdById: true,
        assignedToId: true,
        projectId: true,
        sprintId: true,
        project: {
          select: {
            code: true,
          },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    return ticket;
  }

  private async getTicketAccessContext(
    ticketId: string,
  ): Promise<TicketAccessContext> {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, deletedAt: null },
      select: {
        id: true,
        status: true,
        createdById: true,
        assignedToId: true,
        projectId: true,
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    return ticket;
  }

  private async findAttachmentOrThrow(ticketId: string, attachmentId: string) {
    const attachment = await this.prisma.ticketAttachment.findFirst({
      where: { id: attachmentId, ticketId, deletedAt: null },
    });

    if (!attachment) {
      throw new NotFoundException('Attachment not found');
    }

    return attachment;
  }

  private mapUser(
    user: Prisma.UserGetPayload<{ include: { role: true } }>,
  ): AttachmentUserDto {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role.name,
    };
  }

  private mapAttachment(
    attachment: AttachmentWithUser,
  ): AttachmentResponseDto {
    return {
      id: attachment.id,
      ticketId: attachment.ticketId,
      fileName: attachment.fileName,
      fileSize: attachment.fileSize,
      mimeType: attachment.mimeType,
      createdAt: attachment.createdAt.toISOString(),
      uploadedBy: this.mapUser(attachment.uploadedBy),
    };
  }
}

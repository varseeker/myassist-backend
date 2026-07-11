import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RoleType } from '@prisma/client';
import {
  buildPaginatedResult,
  PaginatedResult,
} from '../common/dto/pagination.dto';
import { AuthenticatedUser } from '../auth/interfaces/auth.interface';
import { NotificationsDispatchService } from '../notifications/notifications-dispatch.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertCanViewTicket,
  TicketAccessContext,
} from '../tickets/ticket-workflow';
import { TicketNotificationContext } from '../notifications/notifications.types';
import { CommentQueryDto } from './dto/comment-query.dto';
import {
  CommentResponseDto,
  CommentUserDto,
  MentionableUserDto,
} from './dto/comment-response.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { extractMentionEmails } from './utils/mention.util';

type CommentWithUser = Prisma.TicketCommentGetPayload<{
  include: { user: { include: { role: true } } };
}>;

const userInclude = { role: true } as const;

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsDispatch: NotificationsDispatchService,
  ) {}

  async findAll(
    ticketId: string,
    query: CommentQueryDto,
    currentUser: AuthenticatedUser,
  ): Promise<PaginatedResult<CommentResponseDto>> {
    const ticket = await this.getTicketAccessContext(ticketId);
    assertCanViewTicket(currentUser.role, currentUser.id, ticket);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.TicketCommentWhereInput = {
      ticketId,
      deletedAt: null,
    };

    const [comments, total] = await this.prisma.$transaction([
      this.prisma.ticketComment.findMany({
        where,
        include: { user: { include: userInclude } },
        skip,
        take: limit,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.ticketComment.count({ where }),
    ]);

    const mentionMap = await this.resolveMentionsForComments(
      comments.map((comment) => comment.content),
    );

    return buildPaginatedResult(
      comments.map((comment) =>
        this.mapComment(comment, mentionMap.get(comment.content) ?? []),
      ),
      total,
      page,
      limit,
    );
  }

  async create(
    ticketId: string,
    dto: CreateCommentDto,
    currentUser: AuthenticatedUser,
  ): Promise<CommentResponseDto> {
    const ticket = await this.getTicketAccessContext(ticketId);
    assertCanViewTicket(currentUser.role, currentUser.id, ticket);

    const content = dto.content.trim();
    const mentions = await this.resolveMentions(content);

    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.ticketComment.create({
        data: {
          ticketId,
          userId: currentUser.id,
          content,
        },
        include: { user: { include: userInclude } },
      });

      await tx.ticketHistory.create({
        data: {
          ticketId,
          userId: currentUser.id,
          action: 'COMMENT_ADDED',
          metadata: {
            commentId: created.id,
            mentionedUserIds: mentions.map((user) => user.id),
          },
        },
      });

      return created;
    });

    void this.notificationsDispatch
      .notifyTicketCommented(
        ticket,
        currentUser.id,
        comment.id,
        mentions.map((user) => user.id),
      )
      .catch(() => undefined);

    return this.mapComment(comment, mentions);
  }

  async update(
    ticketId: string,
    commentId: string,
    dto: UpdateCommentDto,
    currentUser: AuthenticatedUser,
  ): Promise<CommentResponseDto> {
    const ticket = await this.getTicketAccessContext(ticketId);
    assertCanViewTicket(currentUser.role, currentUser.id, ticket);

    const comment = await this.findCommentOrThrow(ticketId, commentId);

    if (comment.userId !== currentUser.id && currentUser.role !== RoleType.ADMIN) {
      throw new ForbiddenException('You can only edit your own comments');
    }

    const content = dto.content.trim();
    const mentions = await this.resolveMentions(content);

    const updated = await this.prisma.ticketComment.update({
      where: { id: commentId },
      data: { content },
      include: { user: { include: userInclude } },
    });

    return this.mapComment(updated, mentions);
  }

  async remove(
    ticketId: string,
    commentId: string,
    currentUser: AuthenticatedUser,
  ): Promise<{ message: string }> {
    const ticket = await this.getTicketAccessContext(ticketId);
    assertCanViewTicket(currentUser.role, currentUser.id, ticket);

    const comment = await this.findCommentOrThrow(ticketId, commentId);

    if (comment.userId !== currentUser.id && currentUser.role !== RoleType.ADMIN) {
      throw new ForbiddenException('You can only delete your own comments');
    }

    await this.prisma.$transaction([
      this.prisma.ticketComment.update({
        where: { id: commentId },
        data: { deletedAt: new Date() },
      }),
      this.prisma.ticketHistory.create({
        data: {
          ticketId,
          userId: currentUser.id,
          action: 'COMMENT_DELETED',
          metadata: { commentId },
        },
      }),
    ]);

    return { message: 'Comment deleted successfully' };
  }

  async getMentionableUsers(
    ticketId: string,
    search: string | undefined,
    currentUser: AuthenticatedUser,
  ): Promise<MentionableUserDto[]> {
    const ticket = await this.getTicketAccessContext(ticketId);
    assertCanViewTicket(currentUser.role, currentUser.id, ticket);

    const participantIds = [ticket.createdById];
    if (ticket.assignedToId) {
      participantIds.push(ticket.assignedToId);
    }

    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      isActive: true,
      id: { not: currentUser.id },
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              { fullName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    if (currentUser.role === RoleType.ADMIN || currentUser.role === RoleType.QA) {
      const users = await this.prisma.user.findMany({
        where,
        select: { id: true, fullName: true, email: true },
        orderBy: { fullName: 'asc' },
        take: 10,
      });

      return users;
    }

    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        id: { not: currentUser.id },
        AND: [
          {
            OR: [
              { id: { in: participantIds } },
              { role: { name: { in: [RoleType.ADMIN, RoleType.QA] } } },
            ],
          },
          ...(search
            ? [
                {
                  OR: [
                    {
                      email: {
                        contains: search,
                        mode: 'insensitive' as const,
                      },
                    },
                    {
                      fullName: {
                        contains: search,
                        mode: 'insensitive' as const,
                      },
                    },
                  ],
                },
              ]
            : []),
        ],
      },
      select: { id: true, fullName: true, email: true },
      orderBy: { fullName: 'asc' },
      take: 10,
    });

    return users;
  }

  private async getTicketAccessContext(
    ticketId: string,
  ): Promise<TicketAccessContext & TicketNotificationContext> {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, deletedAt: null },
      select: {
        id: true,
        ticketNumber: true,
        title: true,
        status: true,
        createdById: true,
        assignedToId: true,
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    return ticket;
  }

  private async findCommentOrThrow(ticketId: string, commentId: string) {
    const comment = await this.prisma.ticketComment.findFirst({
      where: { id: commentId, ticketId, deletedAt: null },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    return comment;
  }

  private async resolveMentions(content: string): Promise<CommentUserDto[]> {
    const emails = extractMentionEmails(content);

    if (emails.length === 0) {
      return [];
    }

    const users = await this.prisma.user.findMany({
      where: {
        email: { in: emails },
        deletedAt: null,
        isActive: true,
      },
      include: userInclude,
    });

    return users.map((user) => this.mapUser(user));
  }

  private async resolveMentionsForComments(
    contents: string[],
  ): Promise<Map<string, CommentUserDto[]>> {
    const allEmails = new Set<string>();

    for (const content of contents) {
      for (const email of extractMentionEmails(content)) {
        allEmails.add(email);
      }
    }

    if (allEmails.size === 0) {
      return new Map();
    }

    const users = await this.prisma.user.findMany({
      where: {
        email: { in: [...allEmails] },
        deletedAt: null,
        isActive: true,
      },
      include: userInclude,
    });

    const usersByEmail = new Map(
      users.map((user) => [user.email.toLowerCase(), this.mapUser(user)]),
    );

    const result = new Map<string, CommentUserDto[]>();

    for (const content of contents) {
      const emails = extractMentionEmails(content);
      const mentions = emails
        .map((email) => usersByEmail.get(email))
        .filter((user): user is CommentUserDto => Boolean(user));

      result.set(content, mentions);
    }

    return result;
  }

  private mapUser(
    user: Prisma.UserGetPayload<{ include: { role: true } }>,
  ): CommentUserDto {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role.name,
    };
  }

  private mapComment(
    comment: CommentWithUser,
    mentions: CommentUserDto[],
  ): CommentResponseDto {
    const isEdited =
      comment.updatedAt.getTime() - comment.createdAt.getTime() > 1000;

    return {
      id: comment.id,
      ticketId: comment.ticketId,
      content: comment.content,
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
      user: this.mapUser(comment.user),
      mentions,
      isEdited,
    };
  }
}

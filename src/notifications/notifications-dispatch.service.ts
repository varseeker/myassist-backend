import { Injectable } from '@nestjs/common';
import { NotificationType, RoleType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { mapNotificationEntity } from './notifications.mapper';
import {
  CreateNotificationInput,
  TicketNotificationContext,
} from './notifications.types';

@Injectable()
export class NotificationsDispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
  ) {}

  async notifyTicketCreated(
    ticket: TicketNotificationContext,
    actorId: string,
  ): Promise<void> {
    const recipients = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        id: { not: actorId },
        role: { name: { in: [RoleType.ADMIN, RoleType.QA] } },
      },
      select: { id: true },
    });

    await this.createAndEmit(
      recipients.map((user) => ({
        userId: user.id,
        type: NotificationType.TICKET_CREATED,
        title: 'New ticket created',
        message: `${ticket.ticketNumber}: ${ticket.title}`,
        data: {
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
        },
      })),
    );
  }

  async notifyTicketStatusChanged(
    ticket: TicketNotificationContext,
    fromStatus: string,
    toStatus: string,
    actorId: string,
    assignedToId?: string,
  ): Promise<void> {
    const recipientIds = new Set<string>();

    if (ticket.createdById !== actorId) {
      recipientIds.add(ticket.createdById);
    }

    const effectiveAssignee = assignedToId ?? ticket.assignedToId;
    if (effectiveAssignee && effectiveAssignee !== actorId) {
      recipientIds.add(effectiveAssignee);
    }

    if (toStatus === 'ASSIGNED' && effectiveAssignee) {
      await this.createAndEmit([
        {
          userId: effectiveAssignee,
          type: NotificationType.TICKET_ASSIGNED,
          title: 'Ticket assigned to you',
          message: `${ticket.ticketNumber}: ${ticket.title}`,
          data: {
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
          },
        },
      ]);

      recipientIds.delete(effectiveAssignee);
    }

    if (recipientIds.size === 0) {
      return;
    }

    await this.createAndEmit(
      [...recipientIds].map((userId) => ({
        userId,
        type: NotificationType.TICKET_STATUS_CHANGED,
        title: 'Ticket status updated',
        message: `${ticket.ticketNumber} moved from ${fromStatus} to ${toStatus}`,
        data: {
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          fromStatus,
          toStatus,
        },
      })),
    );
  }

  async notifyTicketCommented(
    ticket: TicketNotificationContext,
    actorId: string,
    commentId: string,
    mentionedUserIds: string[],
  ): Promise<void> {
    const mentionSet = new Set(
      mentionedUserIds.filter((userId) => userId !== actorId),
    );

    if (mentionSet.size > 0) {
      await this.createAndEmit(
        [...mentionSet].map((userId) => ({
          userId,
          type: NotificationType.TICKET_MENTIONED,
          title: 'You were mentioned',
          message: `You were mentioned on ${ticket.ticketNumber}`,
          data: {
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            commentId,
          },
        })),
      );
    }

    const participantIds = new Set<string>();

    if (ticket.createdById !== actorId && !mentionSet.has(ticket.createdById)) {
      participantIds.add(ticket.createdById);
    }

    if (
      ticket.assignedToId &&
      ticket.assignedToId !== actorId &&
      !mentionSet.has(ticket.assignedToId)
    ) {
      participantIds.add(ticket.assignedToId);
    }

    if (participantIds.size === 0) {
      return;
    }

    await this.createAndEmit(
      [...participantIds].map((userId) => ({
        userId,
        type: NotificationType.TICKET_COMMENTED,
        title: 'New comment on ticket',
        message: `New comment on ${ticket.ticketNumber}`,
        data: {
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          commentId,
        },
      })),
    );
  }

  private async createAndEmit(inputs: CreateNotificationInput[]): Promise<void> {
    if (inputs.length === 0) {
      return;
    }

    const created = await this.prisma.$transaction(
      inputs.map((input) =>
        this.prisma.notification.create({
          data: {
            userId: input.userId,
            type: input.type,
            title: input.title,
            message: input.message,
            data: input.data,
          },
        }),
      ),
    );

    const affectedUserIds = new Set<string>();

    for (const notification of created) {
      affectedUserIds.add(notification.userId);
      this.realtimeService.emitNotification(
        notification.userId,
        mapNotificationEntity(notification),
      );
    }

    await Promise.all(
      [...affectedUserIds].map(async (userId) => {
        const count = await this.prisma.notification.count({
          where: { userId, isRead: false },
        });
        this.realtimeService.emitUnreadCount(userId, count);
      }),
    );
  }
}

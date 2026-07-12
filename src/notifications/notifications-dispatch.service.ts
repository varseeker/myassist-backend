import { Injectable } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { MessagingService } from '../messaging/messaging.service';
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
    private readonly messagingService: MessagingService,
  ) {}

  async notifyTicketCreated(
    ticket: TicketNotificationContext,
    actorId: string,
  ): Promise<void> {
    const recipientIds = await this.messagingService.resolveTicketRecipients({
      actorId,
      event: 'created',
      createdById: ticket.createdById,
      assignedToId: ticket.assignedToId,
      managedById: ticket.managedById,
    });

    await this.createAndEmit(
      recipientIds.map((userId) => ({
        userId,
        type: NotificationType.TICKET_CREATED,
        title: 'New ticket created',
        message: `${ticket.ticketNumber}: ${ticket.title}`,
        data: {
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
        },
      })),
    );

    await this.messagingService.notifyUsers(recipientIds, {
      title: 'New ticket created',
      body: `${ticket.ticketNumber}: ${ticket.title}`,
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
    });
  }

  async notifyTicketStatusChanged(
    ticket: TicketNotificationContext,
    fromStatus: string,
    toStatus: string,
    actorId: string,
    assignedToId?: string,
  ): Promise<void> {
    const effectiveAssignee = assignedToId ?? ticket.assignedToId;

    const recipientIds = await this.messagingService.resolveTicketRecipients({
      actorId,
      event: 'activity',
      createdById: ticket.createdById,
      assignedToId: effectiveAssignee,
      managedById: ticket.managedById,
    });

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

      await this.messagingService.notifyUsers([effectiveAssignee], {
        title: 'Ticket assigned to you',
        body: `${ticket.ticketNumber}: ${ticket.title}`,
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
      });
    }

    const statusRecipients = recipientIds.filter(
      (id) => !(toStatus === 'ASSIGNED' && id === effectiveAssignee),
    );

    if (statusRecipients.length > 0) {
      await this.createAndEmit(
        statusRecipients.map((userId) => ({
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

      await this.messagingService.notifyUsers(statusRecipients, {
        title: 'Ticket status updated',
        body: `${ticket.ticketNumber} moved from ${fromStatus} to ${toStatus}`,
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        metadata: { fromStatus, toStatus },
      });
    }
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
      const mentionIds = [...mentionSet];
      await this.createAndEmit(
        mentionIds.map((userId) => ({
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

      await this.messagingService.notifyUsers(mentionIds, {
        title: 'You were mentioned',
        body: `You were mentioned on ${ticket.ticketNumber}`,
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
      });
    }

    const recipientIds = await this.messagingService.resolveTicketRecipients({
      actorId,
      event: 'activity',
      createdById: ticket.createdById,
      assignedToId: ticket.assignedToId,
      managedById: ticket.managedById,
    });

    const participantIds = recipientIds.filter((id) => !mentionSet.has(id));

    if (participantIds.length === 0) {
      return;
    }

    await this.createAndEmit(
      participantIds.map((userId) => ({
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

    await this.messagingService.notifyUsers(participantIds, {
      title: 'New comment on ticket',
      body: `New comment on ${ticket.ticketNumber}`,
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
    });
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

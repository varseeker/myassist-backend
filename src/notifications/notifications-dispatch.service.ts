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

    const title = 'Tiket baru dibuat';
    const message = `${ticket.ticketNumber} — ${ticket.title}\nStatus awal: menunggu penanganan.`;

    await this.createAndEmit(
      recipientIds.map((userId) => ({
        userId,
        type: NotificationType.TICKET_CREATED,
        title,
        message,
        data: {
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
        },
      })),
    );

    await this.messagingService.notifyUsers(recipientIds, {
      title,
      body: message,
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
    mentionUserId?: string,
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
      const title = 'Tiket ditugaskan kepada Anda';
      const message = `${ticket.ticketNumber} — ${ticket.title}\nStatus: ${fromStatus} → ASSIGNED. Segera kerjakan tiket ini.`;

      await this.createAndEmit([
        {
          userId: effectiveAssignee,
          type: NotificationType.TICKET_ASSIGNED,
          title,
          message,
          data: {
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
          },
        },
      ]);

      await this.messagingService.notifyUsers([effectiveAssignee], {
        title,
        body: message,
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
      });
    }

    if (toStatus === 'RESOLVED' && mentionUserId && mentionUserId !== actorId) {
      const title = 'Diminta uji ulang tiket';
      const message = `${ticket.ticketNumber} — ${ticket.title}\nQA menandai tiket resolved. Mohon coba kembali lalu Close jika sudah OK, atau Reopen jika masih bermasalah.`;

      await this.createAndEmit([
        {
          userId: mentionUserId,
          type: NotificationType.TICKET_MENTIONED,
          title,
          message,
          data: {
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            fromStatus,
            toStatus,
          },
        },
      ]);

      await this.messagingService.notifyUsers([mentionUserId], {
        title,
        body: message,
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
      });
    }

    const statusRecipients = recipientIds.filter(
      (id) =>
        !(toStatus === 'ASSIGNED' && id === effectiveAssignee) &&
        !(toStatus === 'RESOLVED' && id === mentionUserId),
    );

    if (statusRecipients.length > 0) {
      const title = 'Status tiket diperbarui';
      const message = `${ticket.ticketNumber} — ${ticket.title}\nPerubahan status: ${fromStatus} → ${toStatus}`;

      await this.createAndEmit(
        statusRecipients.map((userId) => ({
          userId,
          type: NotificationType.TICKET_STATUS_CHANGED,
          title,
          message,
          data: {
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            fromStatus,
            toStatus,
          },
        })),
      );

      await this.messagingService.notifyUsers(statusRecipients, {
        title,
        body: message,
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
      const title = 'Anda disebut di komentar tiket';
      const message = `${ticket.ticketNumber} — ${ticket.title}\nSeseorang menyebut Anda di komentar. Buka tiket untuk membalas.`;

      await this.createAndEmit(
        mentionIds.map((userId) => ({
          userId,
          type: NotificationType.TICKET_MENTIONED,
          title,
          message,
          data: {
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            commentId,
          },
        })),
      );

      await this.messagingService.notifyUsers(mentionIds, {
        title,
        body: message,
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

    const title = 'Komentar baru pada tiket';
    const message = `${ticket.ticketNumber} — ${ticket.title}\nAda komentar baru. Buka tiket untuk membaca detailnya.`;

    await this.createAndEmit(
      participantIds.map((userId) => ({
        userId,
        type: NotificationType.TICKET_COMMENTED,
        title,
        message,
        data: {
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          commentId,
        },
      })),
    );

    await this.messagingService.notifyUsers(participantIds, {
      title,
      body: message,
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

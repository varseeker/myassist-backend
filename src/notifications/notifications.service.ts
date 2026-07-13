import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  buildPaginatedResult,
  PaginatedResult,
} from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { NotificationResponseDto } from './dto/notification-response.dto';
import { mapNotificationEntity } from './notifications.mapper';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
  ) {}

  async findAll(
    userId: string,
    query: NotificationQueryDto,
  ): Promise<PaginatedResult<NotificationResponseDto>> {
    await this.pruneStaleTicketNotifications(userId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.isRead !== undefined ? { isRead: query.isRead } : {}),
      ...(query.type ? { type: query.type } : {}),
    };

    const [notifications, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return buildPaginatedResult(
      notifications.map((notification) => mapNotificationEntity(notification)),
      total,
      page,
      limit,
    );
  }

  async getUnreadCount(userId: string): Promise<number> {
    await this.pruneStaleTicketNotifications(userId);

    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  async markAsRead(
    userId: string,
    notificationId: string,
  ): Promise<NotificationResponseDto> {
    const notification = await this.findOwnedOrThrow(userId, notificationId);

    const updated = await this.prisma.notification.update({
      where: { id: notification.id },
      data: { isRead: true },
    });

    await this.emitUnreadCount(userId);

    return mapNotificationEntity(updated);
  }

  async markAllAsRead(userId: string): Promise<{ message: string }> {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    this.realtimeService.emitUnreadCount(userId, 0);

    return { message: 'All notifications marked as read' };
  }

  async remove(
    userId: string,
    notificationId: string,
  ): Promise<{ message: string }> {
    await this.findOwnedOrThrow(userId, notificationId);

    await this.prisma.notification.delete({
      where: { id: notificationId },
    });

    await this.emitUnreadCount(userId);

    return { message: 'Notification deleted successfully' };
  }

  async removeAll(userId: string): Promise<{ message: string; deletedCount: number }> {
    const result = await this.prisma.notification.deleteMany({
      where: { userId },
    });

    this.realtimeService.emitUnreadCount(userId, 0);

    return {
      message: `${result.count} notification(s) deleted`,
      deletedCount: result.count,
    };
  }

  /**
   * Hard-delete notifications that point to a (soft-)deleted or missing ticket.
   */
  async deleteByTicketIds(ticketIds: string[]): Promise<number> {
    const uniqueIds = [...new Set(ticketIds.filter(Boolean))];
    if (uniqueIds.length === 0) {
      return 0;
    }

    let deleted = 0;
    const affectedUsers = new Set<string>();

    for (const ticketId of uniqueIds) {
      const matching = await this.prisma.notification.findMany({
        where: {
          data: {
            path: ['ticketId'],
            equals: ticketId,
          },
        },
        select: { id: true, userId: true },
      });

      if (matching.length === 0) {
        continue;
      }

      await this.prisma.notification.deleteMany({
        where: { id: { in: matching.map((item) => item.id) } },
      });

      deleted += matching.length;
      for (const item of matching) {
        affectedUsers.add(item.userId);
      }
    }

    await Promise.all(
      [...affectedUsers].map((userId) => this.emitUnreadCount(userId)),
    );

    return deleted;
  }

  /**
   * Remove notifications whose ticketId no longer exists as an active ticket.
   */
  async pruneStaleTicketNotifications(userId?: string): Promise<number> {
    const candidates = await this.prisma.notification.findMany({
      where: {
        ...(userId ? { userId } : {}),
        data: { not: Prisma.DbNull },
      },
      select: { id: true, userId: true, data: true },
      take: 2_000,
    });

    const ticketIds = new Set<string>();
    for (const item of candidates) {
      const ticketId = this.extractTicketId(item.data);
      if (ticketId) {
        ticketIds.add(ticketId);
      }
    }

    if (ticketIds.size === 0) {
      return 0;
    }

    const activeTickets = await this.prisma.ticket.findMany({
      where: {
        id: { in: [...ticketIds] },
        deletedAt: null,
      },
      select: { id: true },
    });
    const activeSet = new Set(activeTickets.map((ticket) => ticket.id));

    const staleIds: string[] = [];
    const affectedUsers = new Set<string>();

    for (const item of candidates) {
      const ticketId = this.extractTicketId(item.data);
      if (!ticketId) {
        continue;
      }
      if (!activeSet.has(ticketId)) {
        staleIds.push(item.id);
        affectedUsers.add(item.userId);
      }
    }

    if (staleIds.length === 0) {
      return 0;
    }

    await this.prisma.notification.deleteMany({
      where: { id: { in: staleIds } },
    });

    await Promise.all(
      [...affectedUsers].map((id) => this.emitUnreadCount(id)),
    );

    return staleIds.length;
  }

  private extractTicketId(data: Prisma.JsonValue | null): string | null {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return null;
    }
    const ticketId = (data as Record<string, unknown>).ticketId;
    return typeof ticketId === 'string' && ticketId.length > 0 ? ticketId : null;
  }

  private async emitUnreadCount(userId: string): Promise<void> {
    const count = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });
    this.realtimeService.emitUnreadCount(userId, count);
  }

  private async findOwnedOrThrow(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    return notification;
  }
}

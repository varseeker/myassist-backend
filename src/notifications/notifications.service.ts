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

  private async emitUnreadCount(userId: string): Promise<void> {
    const count = await this.getUnreadCount(userId);
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

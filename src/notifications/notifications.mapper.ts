import { Notification } from '@prisma/client';
import { NotificationResponseDto } from './dto/notification-response.dto';

export function mapNotificationEntity(
  notification: Notification,
): NotificationResponseDto {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    data: notification.data as Record<string, unknown> | null,
    isRead: notification.isRead,
    createdAt: notification.createdAt.toISOString(),
    updatedAt: notification.updatedAt.toISOString(),
  };
}

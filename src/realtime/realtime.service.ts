import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';
import { NotificationResponseDto } from '../notifications/dto/notification-response.dto';
import { REALTIME_EVENTS, USER_ROOM_PREFIX } from './realtime.events';

@Injectable()
export class RealtimeService {
  private server?: Server;

  setServer(server: Server): void {
    this.server = server;
  }

  emitNotification(userId: string, notification: NotificationResponseDto): void {
    this.server
      ?.to(`${USER_ROOM_PREFIX}${userId}`)
      .emit(REALTIME_EVENTS.NOTIFICATION_NEW, notification);
  }

  emitUnreadCount(userId: string, count: number): void {
    this.server
      ?.to(`${USER_ROOM_PREFIX}${userId}`)
      .emit(REALTIME_EVENTS.NOTIFICATION_UNREAD_COUNT, { count });
  }
}

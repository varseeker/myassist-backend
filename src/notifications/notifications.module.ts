import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsDispatchService } from './notifications-dispatch.service';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [RealtimeModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsDispatchService],
  exports: [NotificationsDispatchService],
})
export class NotificationsModule {}
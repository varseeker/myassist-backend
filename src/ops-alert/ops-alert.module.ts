import { Global, Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { OpsAlertService } from './ops-alert.service';

@Global()
@Module({
  imports: [MessagingModule],
  providers: [OpsAlertService],
  exports: [OpsAlertService],
})
export class OpsAlertModule {}

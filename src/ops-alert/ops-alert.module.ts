import { Global, Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { PrismaModule } from '../prisma/prisma.module';
import { OpsAlertService } from './ops-alert.service';

@Global()
@Module({
  imports: [PrismaModule, MessagingModule],
  providers: [OpsAlertService],
  exports: [OpsAlertService],
})
export class OpsAlertModule {}

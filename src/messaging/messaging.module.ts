import { Module } from '@nestjs/common';
import { BaileysWhatsAppChannel } from './channels/baileys-whatsapp.channel';
import { MetaWhatsAppChannel } from './channels/meta-whatsapp.channel';
import { TelegramChannel } from './channels/telegram.channel';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';

@Module({
  controllers: [MessagingController],
  providers: [
    BaileysWhatsAppChannel,
    MetaWhatsAppChannel,
    TelegramChannel,
    MessagingService,
  ],
  exports: [MessagingService, TelegramChannel],
})
export class MessagingModule {}

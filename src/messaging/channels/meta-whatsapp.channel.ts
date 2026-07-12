import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessagingChannel } from '@prisma/client';
import { BaseMessagingChannel } from './base.channel';
import {
  ChannelSendResult,
  MessagingRecipient,
  OutboundMessage,
} from '../messaging.types';

/**
 * Placeholder for future Meta WhatsApp Cloud API integration.
 * Switch via MESSAGING_WHATSAPP_DRIVER=meta once credentials are ready.
 */
@Injectable()
export class MetaWhatsAppChannel extends BaseMessagingChannel {
  readonly channel = MessagingChannel.WHATSAPP_META;
  private readonly logger = new Logger(MetaWhatsAppChannel.name);

  constructor(private readonly configService: ConfigService) {
    super();
  }

  isEnabled(): boolean {
    return (
      this.configService.get<string>('MESSAGING_WHATSAPP_DRIVER', 'baileys') ===
        'meta' &&
      Boolean(this.configService.get<string>('WHATSAPP_META_TOKEN')) &&
      Boolean(this.configService.get<string>('WHATSAPP_META_PHONE_NUMBER_ID'))
    );
  }

  async send(
    _recipient: MessagingRecipient,
    _message: OutboundMessage,
  ): Promise<ChannelSendResult> {
    this.logger.warn(
      'Meta WhatsApp Cloud API is not implemented yet. Set MESSAGING_WHATSAPP_DRIVER=baileys for now.',
    );
    return {
      channel: this.channel,
      status: 'SKIPPED',
      error: 'Meta WhatsApp Cloud API driver is reserved for future use',
    };
  }
}

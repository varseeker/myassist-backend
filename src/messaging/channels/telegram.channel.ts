import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessagingChannel } from '@prisma/client';
import { BaseMessagingChannel } from './base.channel';
import {
  ChannelSendResult,
  MessagingRecipient,
  OutboundMessage,
} from '../messaging.types';
import { formatOutboundText } from '../messaging.utils';

@Injectable()
export class TelegramChannel extends BaseMessagingChannel {
  readonly channel = MessagingChannel.TELEGRAM;
  private readonly logger = new Logger(TelegramChannel.name);

  constructor(private readonly configService: ConfigService) {
    super();
  }

  isEnabled(): boolean {
    return (
      this.configService.get<string>('MESSAGING_TELEGRAM_ENABLED', 'true') !==
        'false' && Boolean(this.getBotToken())
    );
  }

  getBotToken(): string | undefined {
    return this.configService.get<string>('TELEGRAM_BOT_TOKEN')?.trim() || undefined;
  }

  getBotUsername(): string | undefined {
    return (
      this.configService.get<string>('TELEGRAM_BOT_USERNAME')?.trim() || undefined
    );
  }

  async send(
    recipient: MessagingRecipient,
    message: OutboundMessage,
  ): Promise<ChannelSendResult> {
    if (!this.isEnabled()) {
      return {
        channel: this.channel,
        status: 'SKIPPED',
        error: 'Telegram channel disabled or missing TELEGRAM_BOT_TOKEN',
      };
    }

    if (!recipient.telegramEnabled || !recipient.telegramChatId) {
      return {
        channel: this.channel,
        status: 'SKIPPED',
        error: 'Recipient has no telegram chat id or telegram disabled',
      };
    }

    const frontendUrl = this.configService.get<string>('FRONTEND_URL')?.trim();
    const link =
      message.ticketId && frontendUrl
        ? `${frontendUrl.replace(/\/$/, '')}/tickets/${message.ticketId}`
        : undefined;

    const text = formatOutboundText(message.title, message.body, link).replace(
      /\*/g,
      '',
    );

    try {
      await this.apiCall('sendMessage', {
        chat_id: recipient.telegramChatId,
        text,
        disable_web_page_preview: false,
      });

      return { channel: this.channel, status: 'SENT' };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Telegram send failed';
      this.logger.warn(`Telegram send failed for ${recipient.userId}: ${errorMessage}`);
      return {
        channel: this.channel,
        status: 'FAILED',
        error: errorMessage,
      };
    }
  }

  async apiCall(method: string, body: Record<string, unknown>): Promise<unknown> {
    const token = this.getBotToken();
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    }

    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const payload = (await response.json()) as {
      ok: boolean;
      description?: string;
      result?: unknown;
    };

    if (!payload.ok) {
      throw new Error(payload.description ?? `Telegram API ${method} failed`);
    }

    return payload.result;
  }
}

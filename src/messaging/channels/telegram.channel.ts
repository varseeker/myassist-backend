import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessagingChannel } from '@prisma/client';
import { BaseMessagingChannel } from './base.channel';
import {
  ChannelSendResult,
  MessagingRecipient,
  OutboundMessage,
} from '../messaging.types';
import { formatTelegramHtml } from '../messaging.utils';

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
        error:
          'Channel Telegram nonaktif atau TELEGRAM_BOT_TOKEN belum diisi di environment backend.',
      };
    }

    if (!recipient.telegramEnabled) {
      return {
        channel: this.channel,
        status: 'SKIPPED',
        error: `Telegram dinonaktifkan untuk ${recipient.fullName}. Aktifkan di form Users.`,
      };
    }

    if (!recipient.telegramChatId) {
      return {
        channel: this.channel,
        status: 'SKIPPED',
        error: `${recipient.fullName} belum menautkan Telegram. Minta user buka link Telegram dari halaman Users → Start bot.`,
      };
    }

    const frontendUrl = this.configService.get<string>('FRONTEND_URL')?.trim();
    const link =
      message.ticketId && frontendUrl
        ? `${frontendUrl.replace(/\/$/, '')}/tickets/${message.ticketId}`
        : undefined;

    const text = formatTelegramHtml(message.title, message.body, link);

    try {
      await this.apiCall('sendMessage', {
        chat_id: recipient.telegramChatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      });

      return { channel: this.channel, status: 'SENT' };
    } catch (error) {
      // Fallback plain text if HTML parse fails
      try {
        const plain = `${message.title}\n\n${message.body}${link ? `\n\n${link}` : ''}`;
        await this.apiCall('sendMessage', {
          chat_id: recipient.telegramChatId,
          text: plain,
          disable_web_page_preview: false,
        });
        return { channel: this.channel, status: 'SENT' };
      } catch (fallbackError) {
        const errorMessage = this.describeSendError(fallbackError ?? error);
        this.logger.warn(
          `Telegram send failed for ${recipient.userId}: ${errorMessage}`,
        );
        return {
          channel: this.channel,
          status: 'FAILED',
          error: `Gagal kirim Telegram ke ${recipient.fullName} (chat ${recipient.telegramChatId}): ${errorMessage}`,
        };
      }
    }
  }

  private describeSendError(error: unknown): string {
    if (!(error instanceof Error)) {
      return 'Kesalahan tidak dikenal dari Telegram API';
    }

    const message = error.message;
    if (/bot was blocked/i.test(message)) {
      return 'User memblokir bot. Minta user unblock @bot lalu Start lagi.';
    }
    if (/chat not found/i.test(message)) {
      return 'Chat tidak ditemukan. User perlu buka ulang link tautan Telegram.';
    }
    if (/unauthorized/i.test(message)) {
      return 'Token bot tidak valid. Periksa TELEGRAM_BOT_TOKEN.';
    }
    return message;
  }

  async apiCall(method: string, body?: Record<string, unknown>): Promise<unknown> {
    const token = this.getBotToken();
    if (!token) {
      throw new Error(
        'TELEGRAM_BOT_TOKEN belum dikonfigurasi. Isi di .env backend lalu restart.',
      );
    }

    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Tidak bisa menghubungi Telegram API: ${detail}`);
    }

    const payload = (await response.json()) as {
      ok: boolean;
      description?: string;
      error_code?: number;
      result?: unknown;
    };

    if (!payload.ok) {
      throw new Error(
        payload.description
          ? `Telegram API ${method} gagal (${payload.error_code ?? response.status}): ${payload.description}`
          : `Telegram API ${method} gagal dengan status HTTP ${response.status}`,
      );
    }

    return payload.result;
  }
}

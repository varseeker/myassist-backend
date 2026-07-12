import { MessagingChannel } from '@prisma/client';

export const MESSAGING_CHANNELS = {
  WHATSAPP: 'whatsapp',
  TELEGRAM: 'telegram',
} as const;

export type OutboundChannelKey =
  (typeof MESSAGING_CHANNELS)[keyof typeof MESSAGING_CHANNELS];

export interface MessagingRecipient {
  userId: string;
  fullName: string;
  phoneNumber?: string | null;
  whatsappEnabled: boolean;
  telegramChatId?: string | null;
  telegramEnabled: boolean;
}

export interface OutboundMessage {
  title: string;
  body: string;
  ticketId?: string;
  ticketNumber?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelSendResult {
  channel: MessagingChannel;
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  error?: string;
  externalId?: string;
}

export interface MessagingChannelDriver {
  readonly channel: MessagingChannel;
  isEnabled(): boolean;
  send(
    recipient: MessagingRecipient,
    message: OutboundMessage,
  ): Promise<ChannelSendResult>;
}

export type WhatsAppConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'qr'
  | 'connected'
  | 'logged_out'
  | 'disabled';

export interface WhatsAppSessionStatus {
  driver: 'baileys' | 'meta' | 'off';
  connected: boolean;
  status: WhatsAppConnectionStatus;
  phoneNumber?: string | null;
  qrDataUrl?: string | null;
  lastError?: string | null;
  hint?: string | null;
  updatedAt: string;
}

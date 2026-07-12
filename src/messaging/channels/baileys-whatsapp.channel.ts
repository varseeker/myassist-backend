import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessagingChannel } from '@prisma/client';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { BaseMessagingChannel } from './base.channel';
import {
  ChannelSendResult,
  MessagingRecipient,
  OutboundMessage,
  WhatsAppSessionStatus,
} from '../messaging.types';
import { formatOutboundText, toWhatsAppJid } from '../messaging.utils';

type BaileysSocket = {
  end: (error?: Error) => void;
  logout: () => Promise<void>;
  sendMessage: (
    jid: string,
    content: { text: string },
  ) => Promise<{ key?: { id?: string | null } } | undefined>;
  user?: { id?: string };
  ev: {
    on: (event: string, listener: (...args: never[]) => void) => void;
  };
};

@Injectable()
export class BaileysWhatsAppChannel
  extends BaseMessagingChannel
  implements OnModuleInit, OnModuleDestroy
{
  readonly channel = MessagingChannel.WHATSAPP_BAILEYS;
  private readonly logger = new Logger(BaileysWhatsAppChannel.name);

  private socket: BaileysSocket | null = null;
  private connecting = false;
  private connected = false;
  private qrDataUrl: string | null = null;
  private phoneNumber: string | null = null;
  private lastError: string | null = null;
  private shouldReconnect = true;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private readonly configService: ConfigService) {
    super();
  }

  isEnabled(): boolean {
    return this.getDriver() === 'baileys';
  }

  private getDriver(): 'baileys' | 'meta' | 'off' {
    const value = (
      this.configService.get<string>('MESSAGING_WHATSAPP_DRIVER', 'baileys') ??
      'baileys'
    ).toLowerCase();
    if (value === 'meta' || value === 'off') {
      return value;
    }
    return 'baileys';
  }

  private getAuthPath(): string {
    return (
      this.configService.get<string>('BAILEYS_AUTH_PATH')?.trim() ||
      join(process.cwd(), '.baileys-auth')
    );
  }

  async onModuleInit(): Promise<void> {
    if (!this.isEnabled()) {
      this.logger.log('Baileys WhatsApp driver is disabled');
      return;
    }

    if (
      this.configService.get<string>('BAILEYS_AUTO_CONNECT', 'true') === 'false'
    ) {
      this.logger.log('Baileys auto-connect disabled');
      return;
    }

    void this.connect().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      this.logger.error(`Baileys initial connect failed: ${message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.socket?.end(undefined);
    } catch {
      // ignore shutdown errors
    }
    this.socket = null;
  }

  getStatus(): WhatsAppSessionStatus {
    const driver = this.getDriver();
    if (driver !== 'baileys') {
      return {
        driver,
        connected: false,
        status: 'disabled',
        phoneNumber: null,
        qrDataUrl: null,
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
    }

    let status: WhatsAppSessionStatus['status'] = 'disconnected';
    if (this.connected) {
      status = 'connected';
    } else if (this.qrDataUrl) {
      status = 'qr';
    } else if (this.connecting) {
      status = 'connecting';
    }

    return {
      driver: 'baileys',
      connected: this.connected,
      status,
      phoneNumber: this.phoneNumber,
      qrDataUrl: this.qrDataUrl,
      lastError: this.lastError,
      updatedAt: new Date().toISOString(),
    };
  }

  async connect(): Promise<WhatsAppSessionStatus> {
    if (!this.isEnabled()) {
      return this.getStatus();
    }

    if (this.connected || this.connecting) {
      return this.getStatus();
    }

    this.connecting = true;
    this.lastError = null;
    this.shouldReconnect = true;

    try {
      await mkdir(this.getAuthPath(), { recursive: true });

      const baileys = await import('@whiskeysockets/baileys');
      const {
        default: makeWASocket,
        DisconnectReason,
        fetchLatestBaileysVersion,
        useMultiFileAuthState,
      } = baileys;

      const { state, saveCreds } = await useMultiFileAuthState(this.getAuthPath());
      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        syncFullHistory: false,
        markOnlineOnConnect: false,
      }) as unknown as BaileysSocket;

      this.socket = sock;

      sock.ev.on('creds.update', saveCreds as never);

      sock.ev.on('connection.update', (async (update: {
        connection?: string;
        lastDisconnect?: { error?: { output?: { statusCode?: number }; message?: string } };
        qr?: string;
      }) => {
        if (update.qr) {
          this.qrDataUrl = await QRCode.toDataURL(update.qr);
          this.connected = false;
          this.logger.log('WhatsApp QR ready — scan from Messaging admin page');
        }

        if (update.connection === 'open') {
          this.connected = true;
          this.connecting = false;
          this.qrDataUrl = null;
          this.phoneNumber = sock.user?.id?.split(':')[0] ?? null;
          this.lastError = null;
          this.logger.log(`WhatsApp connected as ${this.phoneNumber ?? 'unknown'}`);
        }

        if (update.connection === 'close') {
          this.connected = false;
          this.connecting = false;
          this.socket = null;

          const statusCode =
            update.lastDisconnect?.error?.output?.statusCode ??
            update.lastDisconnect?.error?.message;
          const loggedOut =
            statusCode === DisconnectReason.loggedOut ||
            statusCode === 'loggedOut';

          this.lastError = loggedOut
            ? 'WhatsApp session logged out. Scan QR again.'
            : `Connection closed (${String(statusCode ?? 'unknown')})`;

          this.logger.warn(this.lastError);

          if (!loggedOut && this.shouldReconnect) {
            this.scheduleReconnect();
          }
        }
      }) as never);
    } catch (error) {
      this.connecting = false;
      this.connected = false;
      this.lastError =
        error instanceof Error ? error.message : 'Failed to start Baileys';
      this.logger.error(this.lastError);
    }

    return this.getStatus();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, 5000);
  }

  async disconnect(logout = false): Promise<WhatsAppSessionStatus> {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    try {
      if (logout && this.socket) {
        await this.socket.logout();
      } else {
        this.socket?.end(undefined);
      }
    } catch (error) {
      this.lastError =
        error instanceof Error ? error.message : 'Failed to disconnect WhatsApp';
    }

    this.socket = null;
    this.connected = false;
    this.connecting = false;
    this.qrDataUrl = null;
    if (logout) {
      this.phoneNumber = null;
    }

    return this.getStatus();
  }

  async send(
    recipient: MessagingRecipient,
    message: OutboundMessage,
  ): Promise<ChannelSendResult> {
    if (!this.isEnabled()) {
      return {
        channel: this.channel,
        status: 'SKIPPED',
        error: 'Baileys WhatsApp driver disabled',
      };
    }

    if (!recipient.whatsappEnabled || !recipient.phoneNumber) {
      return {
        channel: this.channel,
        status: 'SKIPPED',
        error: 'Recipient has no phone number or WhatsApp disabled',
      };
    }

    if (!this.connected || !this.socket) {
      return {
        channel: this.channel,
        status: 'FAILED',
        error: 'WhatsApp session is not connected. Scan QR first.',
      };
    }

    const jid = toWhatsAppJid(recipient.phoneNumber);
    if (!jid) {
      return {
        channel: this.channel,
        status: 'FAILED',
        error: 'Invalid phone number format',
      };
    }

    const frontendUrl = this.configService.get<string>('FRONTEND_URL')?.trim();
    const link =
      message.ticketId && frontendUrl
        ? `${frontendUrl.replace(/\/$/, '')}/tickets/${message.ticketId}`
        : undefined;

    const text = formatOutboundText(message.title, message.body, link);

    try {
      const result = await this.socket.sendMessage(jid, { text });
      return {
        channel: this.channel,
        status: 'SENT',
        externalId: result?.key?.id ?? undefined,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'WhatsApp send failed';
      this.logger.warn(
        `WhatsApp send failed for ${recipient.userId}: ${errorMessage}`,
      );
      return {
        channel: this.channel,
        status: 'FAILED',
        error: errorMessage,
      };
    }
  }
}

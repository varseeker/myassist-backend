import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessagingChannel } from '@prisma/client';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { BaseMessagingChannel } from './base.channel';
import {
  ChannelSendResult,
  MessagingRecipient,
  OutboundMessage,
  WhatsAppSessionStatus,
} from '../messaging.types';
import {
  formatOutboundText,
  normalizePhoneNumber,
  resolveMessageLinks,
  toWhatsAppJid,
} from '../messaging.utils';
import { WhatsAppSendGuard } from '../whatsapp-send-guard';

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
  private readonly sendGuard: WhatsAppSendGuard;

  private socket: BaileysSocket | null = null;
  private connecting = false;
  private connected = false;
  private shouldReconnect = true;
  private needsSessionReset = false;
  private qrDataUrl: string | null = null;
  private phoneNumber: string | null = null;
  private lastError: string | null = null;
  private lastHint: string | null = null;
  private statusDetail:
    | 'disconnected'
    | 'connecting'
    | 'qr'
    | 'connected'
    | 'logged_out'
    | 'disabled' = 'disconnected';
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connectionGeneration = 0;

  constructor(private readonly configService: ConfigService) {
    super();
    this.sendGuard = new WhatsAppSendGuard({
      minIntervalMs: this.readInt('WHATSAPP_MIN_INTERVAL_MS', 5_000),
      jitterMs: this.readInt('WHATSAPP_JITTER_MS', 2_000),
      perRecipientCooldownMs: this.readInt(
        'WHATSAPP_PER_RECIPIENT_COOLDOWN_MS',
        90_000,
      ),
      maxPerHour: this.readInt('WHATSAPP_MAX_PER_HOUR', 25),
      maxPerDay: this.readInt('WHATSAPP_MAX_PER_DAY', 120),
    });
  }

  isEnabled(): boolean {
    return this.getDriver() === 'baileys';
  }

  private getDriver(): 'baileys' | 'meta' | 'off' {
    const raw = (
      this.configService.get<string>('MESSAGING_WHATSAPP_DRIVER', 'baileys') ??
      'baileys'
    )
      .trim()
      .toLowerCase();

    if (raw === 'waha') {
      // WAHA removed from active path — treat as baileys for local continuity
      return 'baileys';
    }

    if (raw === 'meta' || raw === 'off' || raw === 'baileys') {
      return raw;
    }

    return 'off';
  }

  private getAuthPath(): string {
    return (
      this.configService.get<string>('BAILEYS_AUTH_PATH')?.trim() ||
      join(process.cwd(), '.baileys-auth')
    );
  }

  private readInt(key: string, fallback: number): number {
    const raw = this.configService.get<string>(key);
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
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
      this.logger.warn(`Baileys auto-connect failed: ${message}`);
    });
  }

  onModuleDestroy(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.socket?.end(undefined);
    } catch {
      // ignore
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
        hint: 'Set MESSAGING_WHATSAPP_DRIVER=baileys untuk memakai QR Baileys.',
        updatedAt: new Date().toISOString(),
      };
    }

    let status = this.statusDetail;
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
      hint: this.lastHint,
      updatedAt: new Date().toISOString(),
    };
  }

  async connect(options?: {
    resetSession?: boolean;
  }): Promise<WhatsAppSessionStatus> {
    if (!this.isEnabled()) {
      this.lastError =
        'Driver WhatsApp Baileys nonaktif. Set MESSAGING_WHATSAPP_DRIVER=baileys.';
      this.lastHint = 'Periksa konfigurasi backend lalu restart server.';
      return this.getStatus();
    }

    const resetSession =
      Boolean(options?.resetSession) || this.needsSessionReset;

    if (this.connected && !resetSession) {
      this.lastError = null;
      this.lastHint =
        'WhatsApp sudah terhubung. Kiriman dibatasi jeda & kuota anti-spam.';
      return this.getStatus();
    }

    if (this.connecting && !resetSession) {
      this.lastHint =
        'Sedang menghubungkan… tunggu QR, atau Reset session jika terlalu lama.';
      return this.getStatus();
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const previousSocket = this.socket;
    this.socket = null;
    try {
      previousSocket?.end(undefined);
    } catch {
      // ignore
    }

    if (resetSession) {
      await this.clearAuthState();
      this.needsSessionReset = false;
      this.phoneNumber = null;
      this.reconnectAttempt = 0;
      this.logger.log('WhatsApp auth cleared — fresh QR');
    }

    this.connecting = true;
    this.connected = false;
    this.qrDataUrl = null;
    this.lastError = null;
    this.lastHint = 'Menyiapkan sesi WhatsApp…';
    this.statusDetail = 'connecting';
    this.shouldReconnect = true;
    const generation = ++this.connectionGeneration;

    try {
      await mkdir(this.getAuthPath(), { recursive: true });

      const baileys = await import('@whiskeysockets/baileys');
      const {
        default: makeWASocket,
        Browsers,
        DisconnectReason,
        fetchLatestBaileysVersion,
        makeCacheableSignalKeyStore,
        useMultiFileAuthState,
      } = baileys;

      const { state, saveCreds } = await useMultiFileAuthState(this.getAuthPath());
      const { version } = await fetchLatestBaileysVersion();

      // Conservative socket options — less “bot-like” noise
      const sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, undefined),
        },
        browser: Browsers.ubuntu('Chrome'),
        printQRInTerminal: false,
        syncFullHistory: false,
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        emitOwnEvents: false,
        fireInitQueries: false,
        connectTimeoutMs: 60_000,
        keepAliveIntervalMs: 30_000,
        retryRequestDelayMs: 800,
        maxMsgRetryCount: 3,
        defaultQueryTimeoutMs: 60_000,
        shouldIgnoreJid: (jid: string) =>
          jid.includes('@broadcast') || jid.includes('newsletter'),
        getMessage: async () => undefined,
      }) as unknown as BaileysSocket;

      if (generation !== this.connectionGeneration) {
        try {
          sock.end(undefined);
        } catch {
          // superseded
        }
        return this.getStatus();
      }

      this.socket = sock;
      sock.ev.on('creds.update', saveCreds as never);

      sock.ev.on(
        'connection.update',
        (async (update: {
          connection?: string;
          lastDisconnect?: {
            error?: {
              output?: { statusCode?: number };
              message?: string;
            };
          };
          qr?: string;
        }) => {
          if (generation !== this.connectionGeneration) {
            return;
          }

          if (update.qr) {
            this.qrDataUrl = await QRCode.toDataURL(update.qr, {
              margin: 2,
              width: 320,
            });
            this.connected = false;
            this.connecting = false;
            this.statusDetail = 'qr';
            this.lastError = null;
            this.lastHint =
              'Scan QR: WhatsApp → Perangkat tertaut → Tautkan perangkat. Jangan spam kirim setelah connect.';
            this.logger.log('WhatsApp QR ready');
          }

          if (update.connection === 'open') {
            this.connected = true;
            this.connecting = false;
            this.qrDataUrl = null;
            this.reconnectAttempt = 0;
            this.phoneNumber = sock.user?.id?.split(':')[0] ?? null;
            this.lastError = null;
            this.lastHint = `Terhubung sebagai +${this.phoneNumber ?? 'unknown'}. Rate-limit aktif (jeda antar pesan + kuota jam/hari).`;
            this.statusDetail = 'connected';
            this.needsSessionReset = false;
            this.logger.log(`WhatsApp connected as ${this.phoneNumber}`);
          }

          if (update.connection === 'close') {
            this.connected = false;
            this.connecting = false;
            if (this.socket === sock) {
              this.socket = null;
            }
            this.qrDataUrl = null;

            const info = this.describeDisconnect(
              update.lastDisconnect?.error,
              DisconnectReason,
            );
            this.lastError = info.message;
            this.lastHint = info.hint;
            this.logger.warn(`WhatsApp closed: ${info.message}`);

            if (info.loggedOut || info.badSession) {
              this.needsSessionReset = true;
              this.statusDetail = 'logged_out';
              this.reconnectAttempt = 0;
              await this.clearAuthState();
              return;
            }

            this.statusDetail = 'disconnected';
            if (this.shouldReconnect && !info.loggedOut) {
              this.scheduleReconnect(info.restartSoon);
            }
          }
        }) as never,
      );
    } catch (error) {
      this.connecting = false;
      this.connected = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.lastHint =
        'Gagal start Baileys. Pastikan BAILEYS_AUTH_PATH bisa ditulis, lalu Reset session.';
      this.statusDetail = 'disconnected';
      this.logger.error(`Baileys connect error: ${this.lastError}`);
    }

    return this.getStatus();
  }

  async disconnect(logout = false): Promise<WhatsAppSessionStatus> {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const sock = this.socket;
    this.socket = null;
    this.connected = false;
    this.connecting = false;
    this.qrDataUrl = null;

    try {
      if (logout && sock) {
        await sock.logout();
        await this.clearAuthState();
        this.needsSessionReset = true;
        this.statusDetail = 'logged_out';
        this.lastHint = 'Logout berhasil. Hubungkan lagi untuk QR baru.';
      } else {
        sock?.end(undefined);
        this.statusDetail = 'disconnected';
        this.lastHint = 'Sesi dihentikan tanpa logout. Hubungkan untuk lanjut.';
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }

    this.phoneNumber = logout ? null : this.phoneNumber;
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
        error:
          'Channel WhatsApp (Baileys) nonaktif. Set MESSAGING_WHATSAPP_DRIVER=baileys.',
      };
    }

    if (!recipient.whatsappEnabled) {
      return {
        channel: this.channel,
        status: 'SKIPPED',
        error: `WhatsApp dinonaktifkan untuk ${recipient.fullName}.`,
      };
    }

    if (!recipient.phoneNumber) {
      return {
        channel: this.channel,
        status: 'SKIPPED',
        error: `${recipient.fullName} belum punya nomor HP.`,
      };
    }

    const jid = toWhatsAppJid(recipient.phoneNumber);
    const recipientKey = normalizePhoneNumber(recipient.phoneNumber);
    if (!jid || !recipientKey) {
      return {
        channel: this.channel,
        status: 'FAILED',
        error: `Nomor HP tidak valid: ${recipient.phoneNumber}`,
      };
    }

    if (!this.connected || !this.socket) {
      return {
        channel: this.channel,
        status: 'FAILED',
        error:
          'WhatsApp belum terhubung. Buka Messaging → Hubungkan → scan QR.',
      };
    }

    const links = resolveMessageLinks(
      this.configService.get<string>('FRONTEND_URL'),
      message.ticketId,
    );
    const text = formatOutboundText(message.title, message.body, links);
    const sock = this.socket;

    const queued = await this.sendGuard.enqueue(recipientKey, async () => {
      if (!this.connected || this.socket !== sock) {
        throw new Error('Sesi WhatsApp terputus saat antrean kirim.');
      }
      return sock.sendMessage(jid, { text });
    }).catch((error: unknown) => ({
      skipped: undefined as string | undefined,
      result: undefined,
      error: error instanceof Error ? error.message : String(error),
    }));

    if ('error' in queued && queued.error) {
      return {
        channel: this.channel,
        status: 'FAILED',
        error: queued.error,
      };
    }

    if (queued.skipped) {
      return {
        channel: this.channel,
        status: 'SKIPPED',
        error: queued.skipped,
      };
    }

    return {
      channel: this.channel,
      status: 'SENT',
      externalId: queued.result?.key?.id ?? undefined,
    };
  }

  private scheduleReconnect(restartSoon: boolean): void {
    if (!this.shouldReconnect || this.reconnectTimer) {
      return;
    }

    this.reconnectAttempt += 1;
    const base = restartSoon ? 2_000 : 5_000;
    const delay = Math.min(
      60_000,
      base * Math.pow(1.6, Math.min(this.reconnectAttempt, 6)),
    );

    this.lastHint = `Reconnect otomatis dalam ~${Math.round(delay / 1000)}s (percobaan ${this.reconnectAttempt}).`;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Reconnect failed: ${message}`);
      });
    }, delay);
  }

  private async clearAuthState(): Promise<void> {
    try {
      await rm(this.getAuthPath(), { recursive: true, force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to clear auth: ${message}`);
    }
  }

  private describeDisconnect(
    error:
      | {
          output?: { statusCode?: number };
          message?: string;
        }
      | undefined,
    DisconnectReason: {
      loggedOut: number;
      badSession: number;
      restartRequired: number;
      timedOut: number;
    },
  ): {
    message: string;
    hint: string;
    loggedOut: boolean;
    badSession: boolean;
    restartSoon: boolean;
  } {
    const statusCode = error?.output?.statusCode;
    const loggedOut = statusCode === DisconnectReason.loggedOut;
    const badSession = statusCode === DisconnectReason.badSession;
    const restartSoon =
      statusCode === DisconnectReason.restartRequired ||
      statusCode === DisconnectReason.timedOut;

    if (loggedOut) {
      return {
        message: 'Logged out dari WhatsApp.',
        hint: 'Klik Reset session lalu Hubungkan untuk QR baru.',
        loggedOut: true,
        badSession: false,
        restartSoon: false,
      };
    }

    if (badSession) {
      return {
        message: 'Sesi korup / bad session.',
        hint: 'Reset session lalu scan QR ulang.',
        loggedOut: false,
        badSession: true,
        restartSoon: false,
      };
    }

    return {
      message: error?.message || `Connection closed (code ${statusCode ?? 'n/a'})`,
      hint: 'Reconnect otomatis akan dicoba. Hindari kirim massal agar tidak restricted.',
      loggedOut: false,
      badSession: false,
      restartSoon,
    };
  }
}

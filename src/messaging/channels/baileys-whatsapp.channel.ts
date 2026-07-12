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

type DisconnectInfo = {
  statusCode?: number;
  loggedOut: boolean;
  badSession: boolean;
  shouldReconnect: boolean;
  message: string;
  hint: string;
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
  private lastHint: string | null = null;
  private statusDetail:
    | WhatsAppSessionStatus['status']
    | 'logged_out' = 'disconnected';
  private needsSessionReset = false;
  private shouldReconnect = true;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private connectionGeneration = 0;

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
      this.lastError = `Gagal menghubungkan WhatsApp saat startup: ${message}`;
      this.lastHint =
        'Buka halaman Messaging lalu klik "Hubungkan / Tampilkan QR".';
      this.logger.error(this.lastError);
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
        hint: 'Driver WhatsApp bukan Baileys. Set MESSAGING_WHATSAPP_DRIVER=baileys untuk memakai QR.',
        updatedAt: new Date().toISOString(),
      };
    }

    let status: WhatsAppSessionStatus['status'] = 'disconnected';
    if (this.connected) {
      status = 'connected';
    } else if (this.needsSessionReset || this.statusDetail === 'logged_out') {
      status = 'logged_out';
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
        'Driver WhatsApp Baileys nonaktif. Set MESSAGING_WHATSAPP_DRIVER=baileys di environment.';
      this.lastHint = 'Periksa konfigurasi backend lalu restart server.';
      return this.getStatus();
    }

    const resetSession =
      Boolean(options?.resetSession) || this.needsSessionReset;

    if (this.connected && !resetSession) {
      this.lastError = null;
      this.lastHint = 'WhatsApp sudah terhubung. Tidak perlu scan QR lagi.';
      return this.getStatus();
    }

    if (this.connecting && !resetSession) {
      this.lastHint =
        'Sedang menghubungkan… tunggu QR muncul, atau klik "Reset session" jika terlalu lama.';
      return this.getStatus();
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Tear down existing socket before starting a fresh connection.
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
      this.logger.log('WhatsApp auth state cleared — generating fresh QR');
    }

    this.connecting = true;
    this.connected = false;
    this.qrDataUrl = null;
    this.lastError = null;
    this.lastHint =
      'Menyiapkan sesi WhatsApp… Jika QR belum muncul dalam 10 detik, klik ulang tombol hubungkan.';
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

      const sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, undefined),
        },
        browser: Browsers.ubuntu('Chrome'),
        printQRInTerminal: false,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: false,
        emitOwnEvents: false,
        fireInitQueries: true,
        connectTimeoutMs: 60_000,
        keepAliveIntervalMs: 15_000,
        retryRequestDelayMs: 500,
        maxMsgRetryCount: 5,
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
              data?: unknown;
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
              'Scan QR ini dengan WhatsApp di HP: Setelan → Perangkat tertaut → Tautkan perangkat. QR kadaluarsa ~40 detik; klik hubungkan lagi jika habis.';
            this.logger.log('WhatsApp QR ready');
          }

          if (update.connection === 'open') {
            this.connected = true;
            this.connecting = false;
            this.qrDataUrl = null;
            this.reconnectAttempt = 0;
            this.phoneNumber = sock.user?.id?.split(':')[0] ?? null;
            this.lastError = null;
            this.lastHint = `Terhubung stabil sebagai +${this.phoneNumber ?? 'unknown'}. Keep-alive aktif; reconnect otomatis jika jaringan putus.`;
            this.statusDetail = 'connected';
            this.needsSessionReset = false;
            this.logger.log(
              `WhatsApp connected as ${this.phoneNumber ?? 'unknown'}`,
            );
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
            this.logger.warn(
              `WhatsApp closed: code=${info.statusCode ?? 'n/a'} ${info.message}`,
            );

            if (info.loggedOut || info.badSession) {
              this.needsSessionReset = true;
              this.statusDetail = 'logged_out';
              this.reconnectAttempt = 0;
              await this.clearAuthState();
              return;
            }

            this.statusDetail = 'disconnected';

            if (info.shouldReconnect && this.shouldReconnect) {
              this.scheduleReconnect(info.statusCode);
            }
          }
        }) as never,
      );
    } catch (error) {
      this.connecting = false;
      this.connected = false;
      this.statusDetail = 'disconnected';
      this.lastError =
        error instanceof Error
          ? `Gagal memulai sesi WhatsApp: ${error.message}`
          : 'Gagal memulai sesi WhatsApp karena kesalahan tidak dikenal.';
      this.lastHint =
        'Pastikan folder BAILEYS_AUTH_PATH bisa ditulis, lalu klik "Reset session & tampilkan QR".';
      this.logger.error(this.lastError);
      if (this.shouldReconnect && !this.needsSessionReset) {
        this.scheduleReconnect();
      }
    }

    return this.getStatus();
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
      connectionReplaced: number;
      restartRequired: number;
      connectionClosed: number;
      timedOut: number;
      multideviceMismatch: number;
      forbidden: number;
      unavailableService: number;
    },
  ): DisconnectInfo {
    const statusCode = error?.output?.statusCode;
    const reasonName =
      statusCode === DisconnectReason.loggedOut
        ? 'loggedOut'
        : statusCode === DisconnectReason.badSession
          ? 'badSession'
          : statusCode === DisconnectReason.connectionReplaced
            ? 'connectionReplaced'
            : statusCode === DisconnectReason.restartRequired
              ? 'restartRequired'
              : statusCode === DisconnectReason.connectionClosed
                ? 'connectionClosed'
                : statusCode === DisconnectReason.timedOut
                  ? 'timedOut/connectionLost'
                  : statusCode === DisconnectReason.multideviceMismatch
                    ? 'multideviceMismatch'
                    : statusCode === DisconnectReason.forbidden
                      ? 'forbidden'
                      : statusCode === DisconnectReason.unavailableService
                        ? 'unavailableService'
                        : error?.message || 'unknown';

    const loggedOut = statusCode === DisconnectReason.loggedOut;
    const badSession = statusCode === DisconnectReason.badSession;
    const restartRequired = statusCode === DisconnectReason.restartRequired;
    const connectionReplaced =
      statusCode === DisconnectReason.connectionReplaced;

    if (loggedOut) {
      return {
        statusCode,
        loggedOut: true,
        badSession: false,
        shouldReconnect: false,
        message:
          'Sesi WhatsApp sudah logout / tidak valid. Kredensial lama telah dibersihkan.',
        hint: 'Klik "Reset session & tampilkan QR", lalu scan ulang dari HP. Pastikan nomor tidak men-unlink perangkat dari aplikasi WhatsApp.',
      };
    }

    if (badSession) {
      return {
        statusCode,
        loggedOut: false,
        badSession: true,
        shouldReconnect: false,
        message: 'File sesi WhatsApp rusak (bad session).',
        hint: 'Klik "Reset session & tampilkan QR" untuk membuat sesi baru.',
      };
    }

    if (connectionReplaced) {
      return {
        statusCode,
        loggedOut: false,
        badSession: false,
        shouldReconnect: false,
        message:
          'Sesi digantikan perangkat lain (connection replaced). WhatsApp hanya mengizinkan satu sesi Baileys aktif.',
        hint: 'Tutup sesi lain / jangan buka QR di dua server sekaligus, lalu hubungkan lagi di sini.',
      };
    }

    if (restartRequired) {
      return {
        statusCode,
        loggedOut: false,
        badSession: false,
        shouldReconnect: true,
        message: 'WhatsApp meminta restart koneksi (normal setelah pairing/update).',
        hint: 'Reconnect cepat sedang dijalankan tanpa menghapus sesi.',
      };
    }

    if (statusCode === DisconnectReason.timedOut) {
      return {
        statusCode,
        loggedOut: false,
        badSession: false,
        shouldReconnect: true,
        message: 'Koneksi WhatsApp timeout / hilang sementara.',
        hint: 'Biasanya karena jaringan. Keep-alive akan mencoba menyambung ulang.',
      };
    }

    return {
      statusCode,
      loggedOut: false,
      badSession: false,
      shouldReconnect: true,
      message: `Koneksi WhatsApp terputus (${reasonName}${statusCode ? ` / ${statusCode}` : ''}).`,
      hint: 'Reconnect otomatis dengan backoff aktif. Jika berulang, cek jaringan/VPS sleep, atau reset session.',
    };
  }

  private async clearAuthState(): Promise<void> {
    const authPath = this.getAuthPath();
    try {
      await rm(authPath, { recursive: true, force: true });
      await mkdir(authPath, { recursive: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to clear Baileys auth state: ${message}`);
    }
  }

  private scheduleReconnect(statusCode?: number): void {
    if (this.reconnectTimer || !this.shouldReconnect || this.needsSessionReset) {
      return;
    }

    this.reconnectAttempt += 1;
    // restartRequired (515) should reconnect quickly; otherwise exponential backoff
    const baseDelay = statusCode === 515 ? 1500 : 2000;
    const delay = Math.min(
      baseDelay * 2 ** Math.min(this.reconnectAttempt - 1, 5),
      60_000,
    );

    this.lastHint = `Koneksi terputus. Reconnect otomatis #${this.reconnectAttempt} dalam ${Math.round(delay / 1000)}s…`;
    this.logger.log(this.lastHint);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
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
        error instanceof Error
          ? `Gagal memutus WhatsApp: ${error.message}`
          : 'Gagal memutus koneksi WhatsApp.';
    }

    this.socket = null;
    this.connected = false;
    this.connecting = false;
    this.qrDataUrl = null;

    if (logout) {
      this.phoneNumber = null;
      this.needsSessionReset = true;
      this.statusDetail = 'logged_out';
      await this.clearAuthState();
      this.lastError = 'Sesi WhatsApp di-logout dari server.';
      this.lastHint =
        'Klik "Reset session & tampilkan QR" lalu scan ulang untuk menghubungkan lagi.';
    } else {
      this.statusDetail = 'disconnected';
      this.lastError = 'WhatsApp diputus sementara (session file masih ada).';
      this.lastHint =
        'Klik "Hubungkan" untuk menyambung ulang tanpa scan QR (jika sesi masih valid).';
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
        error:
          'Channel WhatsApp (Baileys) nonaktif. Set MESSAGING_WHATSAPP_DRIVER=baileys.',
      };
    }

    if (!recipient.whatsappEnabled) {
      return {
        channel: this.channel,
        status: 'SKIPPED',
        error: `WhatsApp dinonaktifkan untuk ${recipient.fullName}. Aktifkan di form Users.`,
      };
    }

    if (!recipient.phoneNumber) {
      return {
        channel: this.channel,
        status: 'SKIPPED',
        error: `${recipient.fullName} belum punya nomor WhatsApp. Isi phone number di Users.`,
      };
    }

    if (this.needsSessionReset || this.statusDetail === 'logged_out') {
      return {
        channel: this.channel,
        status: 'FAILED',
        error:
          'Sesi WhatsApp logout. Admin harus scan QR ulang di halaman Messaging.',
      };
    }

    if (!this.connected || !this.socket) {
      return {
        channel: this.channel,
        status: 'FAILED',
        error:
          'WhatsApp belum terhubung. Buka Messaging → Hubungkan / tampilkan QR, lalu scan dari HP.',
      };
    }

    const jid = toWhatsAppJid(recipient.phoneNumber);
    if (!jid) {
      return {
        channel: this.channel,
        status: 'FAILED',
        error: `Nomor WhatsApp tidak valid untuk ${recipient.fullName}: "${recipient.phoneNumber}". Gunakan format 08… atau +62…`,
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
        error instanceof Error ? error.message : 'Kesalahan tidak dikenal';
      this.logger.warn(
        `WhatsApp send failed for ${recipient.userId}: ${errorMessage}`,
      );
      return {
        channel: this.channel,
        status: 'FAILED',
        error: `Gagal kirim WhatsApp ke ${recipient.fullName} (+${recipient.phoneNumber}): ${errorMessage}`,
      };
    }
  }
}

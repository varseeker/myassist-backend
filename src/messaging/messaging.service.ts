import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MessagingDeliveryStatus,
  Prisma,
  RoleType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MetaWhatsAppChannel } from './channels/meta-whatsapp.channel';
import { TelegramChannel } from './channels/telegram.channel';
import { BaileysWhatsAppChannel } from './channels/baileys-whatsapp.channel';
import {
  ChannelSendResult,
  MessagingChannelDriver,
  MessagingRecipient,
  OutboundMessage,
  WhatsAppSessionStatus,
} from './messaging.types';
import { createTelegramLinkToken } from './messaging.utils';

@Injectable()
export class MessagingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessagingService.name);
  private telegramPolling = false;
  private telegramIngressMode: 'polling' | 'webhook' | 'disabled' = 'disabled';
  private telegramPollOffset = 0;
  private telegramPollTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly baileysChannel: BaileysWhatsAppChannel,
    private readonly metaChannel: MetaWhatsAppChannel,
    private readonly telegramChannel: TelegramChannel,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.initTelegramIngress();
  }

  onModuleDestroy(): void {
    this.telegramPolling = false;
    if (this.telegramPollTimer) {
      clearTimeout(this.telegramPollTimer);
      this.telegramPollTimer = null;
    }
  }

  async getWhatsAppStatus(): Promise<WhatsAppSessionStatus> {
    if (this.metaChannel.isEnabled()) {
      return {
        driver: 'meta',
        connected: false,
        status: 'disabled',
        phoneNumber: null,
        qrDataUrl: null,
        lastError: 'Meta driver reserved — implement Cloud API credentials later',
        updatedAt: new Date().toISOString(),
      };
    }

    return this.baileysChannel.getStatus();
  }

  connectWhatsApp(options?: {
    resetSession?: boolean;
  }): Promise<WhatsAppSessionStatus> {
    return this.baileysChannel.connect(options);
  }

  disconnectWhatsApp(logout = false): Promise<WhatsAppSessionStatus> {
    return this.baileysChannel.disconnect(logout);
  }

  async getTelegramStatus() {
    const enabled = this.telegramChannel.isEnabled();
    const username = this.telegramChannel.getBotUsername();
    const linkedUsers = enabled
      ? await this.prisma.user.count({
          where: {
            deletedAt: null,
            isActive: true,
            telegramEnabled: true,
            telegramChatId: { not: null },
          },
        })
      : 0;

    return {
      enabled,
      botUsername: username ?? null,
      deepLinkPrefix: username ? `https://t.me/${username}?start=` : null,
      ingressMode: this.telegramIngressMode,
      linkedUsers,
      hint: !enabled
        ? 'Isi TELEGRAM_BOT_TOKEN & TELEGRAM_BOT_USERNAME, lalu restart backend.'
        : linkedUsers === 0
          ? 'Belum ada user yang menautkan Telegram. Buka Users → salin Telegram link → user tekan Start.'
          : `Telegram aktif. Notifikasi tiket dikirim ke WhatsApp dan Telegram secara paralel (${linkedUsers} user tertaut).`,
    };
  }

  async ensureTelegramLinkToken(userId: string): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { telegramLinkToken: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    if (user.telegramLinkToken) {
      return user.telegramLinkToken;
    }

    const token = createTelegramLinkToken();
    await this.prisma.user.update({
      where: { id: userId },
      data: { telegramLinkToken: token },
    });
    return token;
  }

  async handleTelegramUpdate(update: {
    message?: {
      chat?: { id?: number | string };
      text?: string;
      from?: { first_name?: string };
    };
  }): Promise<void> {
    const message = update.message;
    const chatId = message?.chat?.id;
    const text = message?.text?.trim();

    if (!chatId || !text) {
      return;
    }

    const chatIdStr = String(chatId);

    if (text.startsWith('/start')) {
      const token = text.split(/\s+/)[1]?.trim();
      if (!token) {
        await this.telegramChannel.apiCall('sendMessage', {
          chat_id: chatIdStr,
          text:
            '👋 Selamat datang di *MyAssist Bot*.\n\n' +
            'Untuk menautkan akun:\n' +
            '1. Minta admin membuka menu Users\n' +
            '2. Salin “Telegram link” milik Anda\n' +
            '3. Buka link tersebut, lalu tekan Start\n\n' +
            'Atau kirim manual: /link <token>',
          parse_mode: 'Markdown',
        });
        return;
      }

      await this.linkTelegramChat(token, chatIdStr);
      return;
    }

    if (text.startsWith('/link')) {
      const token = text.split(/\s+/)[1]?.trim();
      if (!token) {
        await this.telegramChannel.apiCall('sendMessage', {
          chat_id: chatIdStr,
          text:
            'Format salah.\n\nKirim: /link <token>\nContoh: /link ab12cd34\n\nToken didapat dari admin di halaman Users → Edit user → Telegram link.',
        });
        return;
      }
      await this.linkTelegramChat(token, chatIdStr);
    }
  }

  private async linkTelegramChat(token: string, chatId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { telegramLinkToken: token, deletedAt: null },
      select: { id: true, fullName: true, email: true },
    });

    if (!user) {
      await this.telegramChannel.apiCall('sendMessage', {
        chat_id: chatId,
        text:
          '❌ Token tidak valid atau sudah tidak aktif.\n\nMinta admin membuka Users → Edit akun Anda → salin ulang Telegram link, lalu buka link tersebut.',
      });
      return;
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        telegramChatId: chatId,
        telegramEnabled: true,
      },
    });

    await this.telegramChannel.apiCall('sendMessage', {
      chat_id: chatId,
      text:
        `✅ Berhasil terhubung ke MyAssist.\n\n` +
        `Akun: ${user.fullName}\n` +
        `Email: ${user.email}\n\n` +
        `Notifikasi tiket yang relevan akan dikirim ke chat ini.`,
    });
  }

  async notifyUsers(
    userIds: string[],
    message: OutboundMessage,
  ): Promise<void> {
    const uniqueIds = [...new Set(userIds.filter(Boolean))];
    if (uniqueIds.length === 0) {
      return;
    }

    const users = await this.prisma.user.findMany({
      where: {
        id: { in: uniqueIds },
        deletedAt: null,
        isActive: true,
      },
      select: {
        id: true,
        fullName: true,
        phoneNumber: true,
        whatsappEnabled: true,
        telegramChatId: true,
        telegramEnabled: true,
      },
    });

    // Always attempt WhatsApp + Telegram independently (failure on one must not block the other)
    const drivers = this.getActiveDrivers();
    if (drivers.length === 0) {
      this.logger.warn(
        'Tidak ada channel messaging aktif (WhatsApp/Telegram). Notifikasi luar tidak terkirim.',
      );
      return;
    }

    await Promise.all(
      users.map(async (user) => {
        const recipient: MessagingRecipient = {
          userId: user.id,
          fullName: user.fullName,
          phoneNumber: user.phoneNumber,
          whatsappEnabled: user.whatsappEnabled,
          telegramChatId: user.telegramChatId,
          telegramEnabled: user.telegramEnabled,
        };

        const results = await Promise.all(
          drivers.map(async (driver) => {
            try {
              return await driver.send(recipient, message);
            } catch (error) {
              const errorMessage =
                error instanceof Error
                  ? error.message
                  : 'Unknown messaging error';
              this.logger.warn(
                `Messaging failed [${driver.channel}] user=${user.id}: ${errorMessage}`,
              );
              return {
                channel: driver.channel,
                status: 'FAILED' as const,
                error: errorMessage,
              } satisfies ChannelSendResult;
            }
          }),
        );

        await Promise.all(
          results.map((result) =>
            this.prisma.messagingDeliveryLog.create({
              data: {
                userId: user.id,
                channel: result.channel,
                status: result.status as MessagingDeliveryStatus,
                title: message.title,
                message: message.body,
                payload: {
                  ticketId: message.ticketId,
                  ticketNumber: message.ticketNumber,
                  externalId: result.externalId,
                  metadata: message.metadata,
                } as Prisma.InputJsonValue,
                error: result.error,
              },
            }),
          ),
        );

        const sent = results.filter((item) => item.status === 'SENT');
        const failed = results.filter((item) => item.status === 'FAILED');
        if (sent.length > 0 || failed.length > 0) {
          this.logger.log(
            `Notify ${user.fullName}: sent=[${sent.map((s) => s.channel).join(',')}] failed=[${failed
              .map((f) => f.channel)
              .join(',')}]`,
          );
        }
      }),
    );
  }

  async sendTestNotification(userId: string): Promise<{
    whatsapp: ChannelSendResult | null;
    telegram: ChannelSendResult | null;
  }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        fullName: true,
        phoneNumber: true,
        whatsappEnabled: true,
        telegramChatId: true,
        telegramEnabled: true,
      },
    });

    if (!user) {
      throw new Error('User tidak ditemukan');
    }

    const recipient: MessagingRecipient = {
      userId: user.id,
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
      whatsappEnabled: user.whatsappEnabled,
      telegramChatId: user.telegramChatId,
      telegramEnabled: user.telegramEnabled,
    };

    const message: OutboundMessage = {
      title: 'Tes notifikasi MyAssist',
      body: `Halo ${user.fullName},\nIni pesan uji coba dari channel WhatsApp + Telegram.\nJika Anda menerima ini, konfigurasi sudah benar.`,
    };

    const [whatsapp, telegram] = await Promise.all([
      this.baileysChannel.isEnabled()
        ? this.baileysChannel.send(recipient, message)
        : this.metaChannel.isEnabled()
          ? this.metaChannel.send(recipient, message)
          : Promise.resolve(null),
      this.telegramChannel.isEnabled()
        ? this.telegramChannel.send(recipient, message)
        : Promise.resolve(null),
    ]);

    for (const result of [whatsapp, telegram]) {
      if (!result) continue;
      await this.prisma.messagingDeliveryLog.create({
        data: {
          userId: user.id,
          channel: result.channel,
          status: result.status as MessagingDeliveryStatus,
          title: message.title,
          message: message.body,
          error: result.error,
          payload: { test: true } as Prisma.InputJsonValue,
        },
      });
    }

    return { whatsapp, telegram };
  }

  /**
   * Resolve outbound recipients by role rules:
   * - ADMIN: all ticket activities
   * - USER: only tickets they created
   * - QA: tickets they manage (managedById) + all QAs on ticket created
   * - DEVELOPER: only assigned tickets
   */
  async resolveTicketRecipients(params: {
    actorId: string;
    event: 'created' | 'activity';
    createdById: string;
    assignedToId?: string | null;
    managedById?: string | null;
  }): Promise<string[]> {
    const recipientIds = new Set<string>();

    const admins = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        role: { name: RoleType.ADMIN },
      },
      select: { id: true },
    });

    for (const admin of admins) {
      if (admin.id !== params.actorId) {
        recipientIds.add(admin.id);
      }
    }

    if (params.event === 'created') {
      const qas = await this.prisma.user.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          role: { name: RoleType.QA },
        },
        select: { id: true },
      });
      for (const qa of qas) {
        if (qa.id !== params.actorId) {
          recipientIds.add(qa.id);
        }
      }
      return [...recipientIds];
    }

    if (params.createdById && params.createdById !== params.actorId) {
      const creator = await this.prisma.user.findFirst({
        where: {
          id: params.createdById,
          deletedAt: null,
          isActive: true,
        },
        select: { id: true, role: { select: { name: true } } },
      });
      // Notify ticket creator (especially USER role)
      if (creator) {
        recipientIds.add(creator.id);
      }
    }

    if (params.managedById && params.managedById !== params.actorId) {
      recipientIds.add(params.managedById);
    }

    if (params.assignedToId && params.assignedToId !== params.actorId) {
      recipientIds.add(params.assignedToId);
    }

    return [...recipientIds];
  }

  private getActiveDrivers(): MessagingChannelDriver[] {
    const drivers: MessagingChannelDriver[] = [];

    if (this.metaChannel.isEnabled()) {
      drivers.push(this.metaChannel);
    } else if (this.baileysChannel.isEnabled()) {
      drivers.push(this.baileysChannel);
    }

    // Telegram always runs alongside WhatsApp when configured
    if (this.telegramChannel.isEnabled()) {
      drivers.push(this.telegramChannel);
    }

    return drivers;
  }

  private async initTelegramIngress(): Promise<void> {
    if (!this.telegramChannel.isEnabled()) {
      this.telegramIngressMode = 'disabled';
      this.logger.log('Telegram channel disabled');
      return;
    }

    const forcedPolling =
      this.configService.get<string>('TELEGRAM_USE_POLLING', '') === 'true';
    const forcedWebhook =
      this.configService.get<string>('TELEGRAM_USE_POLLING', '') === 'false';
    const appUrl = this.configService.get<string>('APP_URL')?.trim();
    const isLocalApp =
      !appUrl ||
      appUrl.includes('localhost') ||
      appUrl.includes('127.0.0.1');

    const usePolling = forcedPolling || (!forcedWebhook && isLocalApp);

    try {
      if (usePolling) {
        await this.telegramChannel.apiCall('deleteWebhook', {
          drop_pending_updates: false,
        });
        this.telegramIngressMode = 'polling';
        this.telegramPolling = true;
        this.logger.log(
          'Telegram long-polling aktif (cocok untuk local/dev). User bisa /start untuk link akun.',
        );
        this.queueTelegramPoll();
        return;
      }

      const webhookUrl = `${appUrl!.replace(/\/$/, '')}/api/v1/messaging/telegram/webhook`;
      await this.telegramChannel.apiCall('setWebhook', {
        url: webhookUrl,
        drop_pending_updates: false,
      });
      this.telegramIngressMode = 'webhook';
      this.logger.log(`Telegram webhook diset ke ${webhookUrl}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(`Gagal init Telegram ingress: ${detail}`);
      this.telegramIngressMode = 'disabled';
    }
  }

  private queueTelegramPoll(): void {
    if (!this.telegramPolling) {
      return;
    }

    this.telegramPollTimer = setTimeout(() => {
      void this.pollTelegramUpdates();
    }, 800);
  }

  private async pollTelegramUpdates(): Promise<void> {
    if (!this.telegramPolling) {
      return;
    }

    try {
      const updates = (await this.telegramChannel.apiCall('getUpdates', {
        offset: this.telegramPollOffset,
        timeout: 25,
        allowed_updates: ['message'],
      })) as Array<{
        update_id: number;
        message?: {
          chat?: { id?: number | string };
          text?: string;
        };
      }>;

      for (const update of updates ?? []) {
        this.telegramPollOffset = update.update_id + 1;
        await this.handleTelegramUpdate(update);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Telegram polling error: ${detail}`);
    } finally {
      this.queueTelegramPoll();
    }
  }
}

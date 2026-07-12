import { Injectable, Logger } from '@nestjs/common';
import {
  MessagingDeliveryStatus,
  Prisma,
  RoleType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BaileysWhatsAppChannel } from './channels/baileys-whatsapp.channel';
import { MetaWhatsAppChannel } from './channels/meta-whatsapp.channel';
import { TelegramChannel } from './channels/telegram.channel';
import {
  MessagingChannelDriver,
  MessagingRecipient,
  OutboundMessage,
  WhatsAppSessionStatus,
} from './messaging.types';
import { createTelegramLinkToken } from './messaging.utils';

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly baileysChannel: BaileysWhatsAppChannel,
    private readonly metaChannel: MetaWhatsAppChannel,
    private readonly telegramChannel: TelegramChannel,
  ) {}

  getWhatsAppStatus(): WhatsAppSessionStatus {
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

  connectWhatsApp(): Promise<WhatsAppSessionStatus> {
    return this.baileysChannel.connect();
  }

  disconnectWhatsApp(logout = false): Promise<WhatsAppSessionStatus> {
    return this.baileysChannel.disconnect(logout);
  }

  getTelegramStatus() {
    const enabled = this.telegramChannel.isEnabled();
    const username = this.telegramChannel.getBotUsername();
    return {
      enabled,
      botUsername: username ?? null,
      deepLinkPrefix: username ? `https://t.me/${username}?start=` : null,
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
            'MyAssist bot.\n\nMinta link Telegram ke admin, lalu buka link tersebut untuk menghubungkan akun.\nAtau kirim: /link <token>',
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
          text: 'Format: /link <token>',
        });
        return;
      }
      await this.linkTelegramChat(token, chatIdStr);
    }
  }

  private async linkTelegramChat(token: string, chatId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { telegramLinkToken: token, deletedAt: null },
      select: { id: true, fullName: true },
    });

    if (!user) {
      await this.telegramChannel.apiCall('sendMessage', {
        chat_id: chatId,
        text: 'Token tidak valid atau sudah dipakai. Minta token baru ke admin.',
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
      text: `Berhasil terhubung ke MyAssist sebagai ${user.fullName}. Notifikasi tiket akan dikirim ke chat ini.`,
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

    const drivers = this.getActiveDrivers();

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

        for (const driver of drivers) {
          try {
            const result = await driver.send(recipient, message);
            await this.prisma.messagingDeliveryLog.create({
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
            });
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : 'Unknown messaging error';
            this.logger.warn(
              `Messaging failed [${driver.channel}] user=${user.id}: ${errorMessage}`,
            );
            await this.prisma.messagingDeliveryLog.create({
              data: {
                userId: user.id,
                channel: driver.channel,
                status: MessagingDeliveryStatus.FAILED,
                title: message.title,
                message: message.body,
                error: errorMessage,
              },
            });
          }
        }
      }),
    );
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

    if (this.telegramChannel.isEnabled()) {
      drivers.push(this.telegramChannel);
    }

    return drivers;
  }
}

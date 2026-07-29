import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RoleType } from '@prisma/client';
import { TelegramChannel } from '../messaging/channels/telegram.channel';
import { PrismaService } from '../prisma/prisma.service';

export type OpsAlertType =
  | 'http_error'
  | 'database'
  | 'process'
  | 'health'
  | 'shutdown'
  | 'startup'
  | 'generic';

export interface OpsAlertPayload {
  type: OpsAlertType;
  title: string;
  body: string;
  /** Dedup key — same key is rate-limited */
  key?: string;
  force?: boolean;
}

interface CachedAdminChat {
  userId: string;
  fullName: string;
  chatId: string;
}

@Injectable()
export class OpsAlertService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OpsAlertService.name);
  private readonly lastSentAt = new Map<string, number>();
  private cachedAdmins: CachedAdminChat[] = [];
  private cacheTimer: NodeJS.Timeout | null = null;
  private sending = false;
  private processHandlersRegistered = false;

  private readonly cooldownMs: number;
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramChannel,
    private readonly configService: ConfigService,
  ) {
    this.enabled =
      this.configService.get<string>('OPS_ALERT_ENABLED', 'true') !== 'false';
    this.cooldownMs = Number(
      this.configService.get<string>('OPS_ALERT_COOLDOWN_MS', '300000'),
    );
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.warn('Ops Telegram alerts are disabled (OPS_ALERT_ENABLED=false)');
      return;
    }

    await this.refreshAdminCache();
    this.cacheTimer = setInterval(() => {
      void this.refreshAdminCache();
    }, 10 * 60 * 1000);
    this.cacheTimer.unref?.();

    const notifyStartup =
      this.configService.get<string>('OPS_ALERT_NOTIFY_STARTUP', 'false') ===
      'true';
    if (notifyStartup) {
      void this.alert({
        type: 'startup',
        title: 'MyAssist API started',
        body: `Service is online at ${new Date().toISOString()}`,
        key: 'startup',
      });
    }
  }

  onModuleDestroy(): void {
    if (this.cacheTimer) {
      clearInterval(this.cacheTimer);
      this.cacheTimer = null;
    }
  }

  registerProcessHandlers(): void {
    if (this.processHandlersRegistered || !this.enabled) {
      return;
    }
    this.processHandlersRegistered = true;

    process.on('uncaughtException', (error) => {
      this.logger.error(`uncaughtException: ${error.message}`, error.stack);
      void this.alert({
        type: 'process',
        title: 'Uncaught exception',
        body: this.formatError(error),
        key: `uncaught:${error.message.slice(0, 80)}`,
      });
    });

    process.on('unhandledRejection', (reason) => {
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : JSON.stringify(reason);
      this.logger.error(`unhandledRejection: ${message}`);
      void this.alert({
        type: 'process',
        title: 'Unhandled promise rejection',
        body: this.formatError(reason),
        key: `rejection:${message.slice(0, 80)}`,
      });
    });

    const onSignal = (signal: string) => {
      void this.alert({
        type: 'shutdown',
        title: `Service shutting down (${signal})`,
        body: `Process received ${signal} at ${new Date().toISOString()}`,
        key: `shutdown:${signal}:${process.pid}`,
        force: true,
      });
    };

    process.once('SIGTERM', () => onSignal('SIGTERM'));
    process.once('SIGINT', () => onSignal('SIGINT'));
  }

  async alert(payload: OpsAlertPayload): Promise<void> {
    if (!this.enabled) {
      return;
    }

    if (!this.telegram.isEnabled()) {
      return;
    }

    const key = payload.key ?? `${payload.type}:${payload.title}`;
    if (!payload.force && this.isRateLimited(key)) {
      return;
    }

    // Prevent recursive alerts while sending
    if (this.sending && payload.type === 'http_error') {
      return;
    }

    this.lastSentAt.set(key, Date.now());

    const recipients = await this.resolveRecipients();
    if (recipients.length === 0) {
      this.logger.warn(
        'Ops alert skipped: no admin with linked Telegram chat. Link Telegram on an ADMIN user profile.',
      );
      return;
    }

    const text = this.buildMessage(payload);

    this.sending = true;
    try {
      await Promise.all(
        recipients.map(async (admin) => {
          try {
            await this.telegram.apiCall('sendMessage', {
              chat_id: admin.chatId,
              text,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
            });
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.warn(
              `Failed to send ops alert to ${admin.fullName}: ${message}`,
            );
          }
        }),
      );
    } finally {
      this.sending = false;
    }
  }

  async alertHttpError(params: {
    status: number;
    method: string;
    path: string;
    message: string;
    stack?: string;
  }): Promise<void> {
    if (params.status < 500) {
      return;
    }

    // Ignore noisy probe paths unless forced elsewhere
    if (params.path.includes('/health')) {
      return;
    }

    await this.alert({
      type: 'http_error',
      title: `HTTP ${params.status} error`,
      body: [
        `<b>Method:</b> ${this.escape(params.method)}`,
        `<b>Path:</b> ${this.escape(params.path)}`,
        `<b>Message:</b> ${this.escape(params.message)}`,
        params.stack
          ? `<b>Stack:</b>\n<pre>${this.escape(params.stack.slice(0, 1200))}</pre>`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
      key: `http:${params.status}:${params.method}:${params.path}:${params.message.slice(0, 60)}`,
    });
  }

  async alertDatabase(error: unknown): Promise<void> {
    await this.alert({
      type: 'database',
      title: 'Database connection problem',
      body: this.formatError(error),
      key: 'database_down',
    });
  }

  private async resolveRecipients(): Promise<CachedAdminChat[]> {
    if (this.cachedAdmins.length > 0) {
      return this.cachedAdmins;
    }

    await this.refreshAdminCache();
    return this.cachedAdmins;
  }

  private async refreshAdminCache(): Promise<void> {
    const fromEnv = this.parseEnvChatIds();

    try {
      const admins = await this.prisma.user.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          telegramEnabled: true,
          telegramChatId: { not: null },
          role: { name: RoleType.ADMIN },
        },
        select: {
          id: true,
          fullName: true,
          telegramChatId: true,
        },
      });

      const fromDb: CachedAdminChat[] = admins
        .filter((admin) => Boolean(admin.telegramChatId))
        .map((admin) => ({
          userId: admin.id,
          fullName: admin.fullName,
          chatId: admin.telegramChatId as string,
        }));

      const merged = new Map<string, CachedAdminChat>();
      for (const item of [...fromDb, ...fromEnv]) {
        merged.set(item.chatId, item);
      }
      this.cachedAdmins = [...merged.values()];
      this.logger.debug(
        `Ops alert admin cache refreshed: ${this.cachedAdmins.length} recipient(s)`,
      );
    } catch (error) {
      // Keep previous cache if DB is down
      if (this.cachedAdmins.length === 0 && fromEnv.length > 0) {
        this.cachedAdmins = fromEnv;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to refresh ops alert admin cache: ${message}`);
    }
  }

  private parseEnvChatIds(): CachedAdminChat[] {
    const raw =
      this.configService.get<string>('OPS_ALERT_TELEGRAM_CHAT_IDS')?.trim() ||
      '';
    if (!raw) {
      return [];
    }

    return raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((chatId, index) => ({
        userId: `env-${index}`,
        fullName: 'Ops Admin (env)',
        chatId,
      }));
  }

  private isRateLimited(key: string): boolean {
    const last = this.lastSentAt.get(key);
    if (!last) {
      return false;
    }
    return Date.now() - last < this.cooldownMs;
  }

  private buildMessage(payload: OpsAlertPayload): string {
    const env = this.configService.get<string>('NODE_ENV', 'development');
    const appUrl =
      this.configService.get<string>('APP_URL')?.trim() || 'unknown';

    return [
      `🚨 <b>${this.escape(payload.title)}</b>`,
      `<b>Type:</b> ${this.escape(payload.type)}`,
      `<b>Env:</b> ${this.escape(env)}`,
      `<b>App:</b> ${this.escape(appUrl)}`,
      `<b>Time:</b> ${new Date().toISOString()}`,
      '',
      payload.body,
    ].join('\n');
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      const stack = error.stack
        ? `\n<pre>${this.escape(error.stack.slice(0, 1200))}</pre>`
        : '';
      return `<b>Error:</b> ${this.escape(error.message)}${stack}`;
    }
    return `<b>Error:</b> ${this.escape(String(error))}`;
  }

  private escape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

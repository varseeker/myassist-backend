import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleType } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/interfaces/auth.interface';
import {
  ConnectWhatsAppDto,
  DisconnectWhatsAppDto,
  MessagingStatusDto,
  MessagingTestResultDto,
  WhatsAppSessionStatusDto,
} from './dto/messaging-status.dto';
import { MessagingService } from './messaging.service';

@ApiTags('Messaging')
@Controller('messaging')
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  @Get('status')
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(RoleType.ADMIN)
  @ApiOperation({ summary: 'Get WhatsApp + Telegram messaging status' })
  async getStatus(): Promise<MessagingStatusDto> {
    return {
      whatsapp: await this.messagingService.getWhatsAppStatus(),
      telegram: await this.messagingService.getTelegramStatus(),
    };
  }

  @Post('whatsapp/connect')
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(RoleType.ADMIN)
  @ApiOperation({
    summary: 'Start / reconnect Baileys WhatsApp session (optionally reset QR)',
  })
  connectWhatsApp(
    @Body() dto: ConnectWhatsAppDto,
  ): Promise<WhatsAppSessionStatusDto> {
    return this.messagingService.connectWhatsApp({
      resetSession: Boolean(dto.resetSession),
    });
  }

  @Post('whatsapp/disconnect')
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(RoleType.ADMIN)
  @ApiOperation({ summary: 'Disconnect Baileys WhatsApp session' })
  disconnectWhatsApp(
    @Body() dto: DisconnectWhatsAppDto,
  ): Promise<WhatsAppSessionStatusDto> {
    return this.messagingService.disconnectWhatsApp(Boolean(dto.logout));
  }

  @Post('test')
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(RoleType.ADMIN)
  @ApiOperation({
    summary: 'Send a test notification to the current admin via WhatsApp + Telegram',
  })
  async sendTest(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MessagingTestResultDto> {
    const result = await this.messagingService.sendTestNotification(user.id);
    return {
      whatsapp: result.whatsapp
        ? { status: result.whatsapp.status, error: result.whatsapp.error }
        : null,
      telegram: result.telegram
        ? { status: result.telegram.status, error: result.telegram.error }
        : null,
    };
  }

  @Public()
  @Post('telegram/webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Telegram bot webhook (link accounts via /start token)',
  })
  async telegramWebhook(
    @Body() body: Record<string, unknown>,
  ): Promise<{ ok: true }> {
    await this.messagingService.handleTelegramUpdate(
      body as {
        message?: {
          chat?: { id?: number | string };
          text?: string;
        };
      },
    );
    return { ok: true };
  }
}

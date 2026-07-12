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
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  DisconnectWhatsAppDto,
  MessagingStatusDto,
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
  getStatus(): MessagingStatusDto {
    return {
      whatsapp: this.messagingService.getWhatsAppStatus(),
      telegram: this.messagingService.getTelegramStatus(),
    };
  }

  @Post('whatsapp/connect')
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(RoleType.ADMIN)
  @ApiOperation({ summary: 'Start / reconnect Baileys WhatsApp session' })
  connectWhatsApp(): Promise<WhatsAppSessionStatusDto> {
    return this.messagingService.connectWhatsApp();
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

  @Public()
  @Post('telegram/webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Telegram bot webhook (link accounts via /start token)' })
  async telegramWebhook(@Body() body: Record<string, unknown>): Promise<{ ok: true }> {
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

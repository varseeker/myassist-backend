import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class WhatsAppSessionStatusDto {
  @ApiProperty({ enum: ['baileys', 'meta', 'off'] })
  driver!: 'baileys' | 'meta' | 'off';

  @ApiProperty()
  connected!: boolean;

  @ApiProperty({
    enum: [
      'disconnected',
      'connecting',
      'qr',
      'connected',
      'logged_out',
      'disabled',
    ],
  })
  status!:
    | 'disconnected'
    | 'connecting'
    | 'qr'
    | 'connected'
    | 'logged_out'
    | 'disabled';

  @ApiPropertyOptional({ nullable: true })
  phoneNumber?: string | null;

  @ApiPropertyOptional({ nullable: true })
  qrDataUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  lastError?: string | null;

  @ApiPropertyOptional({ nullable: true })
  hint?: string | null;

  @ApiProperty()
  updatedAt!: string;
}

export class TelegramStatusDto {
  @ApiProperty()
  enabled!: boolean;

  @ApiPropertyOptional({ nullable: true })
  botUsername?: string | null;

  @ApiPropertyOptional({ nullable: true })
  deepLinkPrefix?: string | null;

  @ApiProperty({ enum: ['polling', 'webhook', 'disabled'] })
  ingressMode!: 'polling' | 'webhook' | 'disabled';

  @ApiProperty()
  linkedUsers!: number;

  @ApiPropertyOptional({ nullable: true })
  hint?: string | null;
}

export class MessagingStatusDto {
  @ApiProperty({ type: WhatsAppSessionStatusDto })
  whatsapp!: WhatsAppSessionStatusDto;

  @ApiProperty({ type: TelegramStatusDto })
  telegram!: TelegramStatusDto;
}

export class ConnectWhatsAppDto {
  @ApiPropertyOptional({
    description:
      'Clear Baileys credentials and generate a fresh QR (use after logout / bad session)',
  })
  @IsOptional()
  @IsBoolean()
  resetSession?: boolean;
}

export class DisconnectWhatsAppDto {
  @ApiPropertyOptional({
    description: 'If true, logout and clear Baileys session credentials',
  })
  @IsOptional()
  @IsBoolean()
  logout?: boolean;
}

export class MessagingTestResultDto {
  @ApiPropertyOptional({ nullable: true })
  whatsapp?: {
    status: string;
    error?: string;
  } | null;

  @ApiPropertyOptional({ nullable: true })
  telegram?: {
    status: string;
    error?: string;
  } | null;
}

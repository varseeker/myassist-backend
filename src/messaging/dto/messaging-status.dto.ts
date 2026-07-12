import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class WhatsAppSessionStatusDto {
  @ApiProperty({ enum: ['baileys', 'meta', 'off'] })
  driver!: 'baileys' | 'meta' | 'off';

  @ApiProperty()
  connected!: boolean;

  @ApiProperty({
    enum: ['disconnected', 'connecting', 'qr', 'connected', 'disabled'],
  })
  status!: 'disconnected' | 'connecting' | 'qr' | 'connected' | 'disabled';

  @ApiPropertyOptional({ nullable: true })
  phoneNumber?: string | null;

  @ApiPropertyOptional({ nullable: true })
  qrDataUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  lastError?: string | null;

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
}

export class MessagingStatusDto {
  @ApiProperty({ type: WhatsAppSessionStatusDto })
  whatsapp!: WhatsAppSessionStatusDto;

  @ApiProperty({ type: TelegramStatusDto })
  telegram!: TelegramStatusDto;
}

export class DisconnectWhatsAppDto {
  @ApiPropertyOptional({
    description: 'If true, logout and clear Baileys session credentials',
  })
  @IsOptional()
  @IsBoolean()
  logout?: boolean;
}

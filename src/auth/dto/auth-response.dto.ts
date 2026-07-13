import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RoleType } from '@prisma/client';

export class AuthUserProjectDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  isActive!: boolean;
}

export class AuthUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'admin' })
  username!: string;

  @ApiPropertyOptional({ nullable: true })
  email?: string | null;

  @ApiProperty()
  fullName!: string;

  @ApiProperty()
  roleId!: string;

  @ApiProperty({ enum: RoleType })
  role!: RoleType;

  @ApiProperty()
  isActive!: boolean;

  @ApiPropertyOptional({ nullable: true })
  phoneNumber?: string | null;

  @ApiPropertyOptional()
  whatsappEnabled?: boolean;

  @ApiPropertyOptional({ nullable: true })
  telegramChatId?: string | null;

  @ApiPropertyOptional()
  telegramEnabled?: boolean;

  @ApiPropertyOptional({ nullable: true })
  telegramLinkToken?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Deep link to open Telegram bot and auto-link this account',
  })
  telegramDeepLink?: string | null;

  @ApiPropertyOptional({
    description: 'Whether telegramChatId is already linked',
  })
  telegramLinked?: boolean;

  @ApiPropertyOptional({ type: [AuthUserProjectDto] })
  projects?: AuthUserProjectDto[];
}

export class AuthTokensDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;
}

export class MessageResponseDto {
  @ApiProperty()
  message!: string;
}

export class ForgotPasswordResponseDto extends MessageResponseDto {
  @ApiProperty({ required: false })
  resetToken?: string;
}

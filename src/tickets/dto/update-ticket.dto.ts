import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  TicketPriority,
  TicketType,
} from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateTicketDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(10)
  description?: string;

  @ApiPropertyOptional({
    example: 'https://app.example.com/orders',
    description: 'URL of the related menu / page',
  })
  @IsOptional()
  @ValidateIf((_, value) => typeof value === 'string' && value.trim().length > 0)
  @IsUrl(
    { require_protocol: true },
    { message: 'menuUrl must be a valid URL (http:// or https://)' },
  )
  @MaxLength(500)
  menuUrl?: string | null;

  @ApiPropertyOptional({ enum: TicketType })
  @IsOptional()
  @IsEnum(TicketType)
  type?: TicketType;

  @ApiPropertyOptional({ enum: TicketPriority })
  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @ApiPropertyOptional({ description: 'Sprint within the ticket project' })
  @IsOptional()
  @IsUUID()
  sprintId?: string;
}

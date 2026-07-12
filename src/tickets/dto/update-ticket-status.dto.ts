import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TicketStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateTicketStatusDto {
  @ApiProperty({ enum: TicketStatus })
  @IsEnum(TicketStatus)
  status!: TicketStatus;

  @ApiPropertyOptional({ description: 'Required when assigning a developer' })
  @IsOptional()
  @IsUUID()
  assignedToId?: string;

  @ApiPropertyOptional({
    description: 'Required when moving to RESOLVED — user asked to retest',
  })
  @ValidateIf((dto: UpdateTicketStatusDto) => dto.status === TicketStatus.RESOLVED)
  @IsUUID()
  @IsNotEmpty()
  mentionUserId?: string;

  @ApiProperty({ description: 'Required note for every status change' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Note is required when updating status' })
  @MinLength(3, { message: 'Note must be at least 3 characters' })
  @MaxLength(1000)
  note!: string;
}

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
  @ValidateIf(
    (dto: UpdateTicketStatusDto) => dto.status === TicketStatus.RESOLVED,
  )
  @IsUUID()
  @IsNotEmpty()
  mentionUserId?: string;

  @ApiPropertyOptional({
    description:
      'Required only when moving to QA_REVIEW. Optional for assign and other transitions.',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

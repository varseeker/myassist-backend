import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  TicketPriority,
  TicketType,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

function emptyToUndefined({ value }: { value: unknown }) {
  return value === '' || value === null ? undefined : value;
}

export class CreateTicketDto {
  @ApiProperty({ example: 'Login page returns 500 error' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiProperty({ example: 'Steps to reproduce...' })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  description!: string;

  @ApiPropertyOptional({
    example: 'https://app.example.com/orders',
    description: 'URL of the related menu / page',
  })
  @Transform(emptyToUndefined)
  @IsOptional()
  @ValidateIf((_, value) => typeof value === 'string' && value.trim().length > 0)
  @IsUrl(
    { require_protocol: true },
    { message: 'menuUrl must be a valid URL (http:// or https://)' },
  )
  @MaxLength(500)
  menuUrl?: string;

  @ApiPropertyOptional({ enum: TicketType, default: TicketType.ISSUE_REPORT })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsEnum(TicketType)
  type?: TicketType;

  @ApiPropertyOptional({ enum: TicketPriority, default: TicketPriority.MEDIUM })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @ApiPropertyOptional({
    description: 'Required for admin/qa. USER role uses their assigned project.',
  })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({
    description: 'Required for staff roles. USER submissions omit sprint until QA triage.',
  })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsUUID()
  sprintId?: string;
}

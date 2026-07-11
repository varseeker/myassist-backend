import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  TicketPriority,
  TicketStatus,
  TicketType,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class TicketQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TicketStatus })
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @ApiPropertyOptional({ enum: TicketPriority })
  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @ApiPropertyOptional({ enum: TicketType })
  @IsOptional()
  @IsEnum(TicketType)
  type?: TicketType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assignedToId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  createdById?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sprintId?: string;

  @ApiPropertyOptional({
    description: 'Filter by scope: mine (default for USER/DEVELOPER) or all',
    enum: ['mine', 'all'],
  })
  @IsOptional()
  @Transform(({ value }) => (value === 'all' ? 'all' : 'mine'))
  scope?: 'mine' | 'all';
}

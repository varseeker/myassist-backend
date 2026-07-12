import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  TicketPriority,
  TicketStatus,
  TicketType,
} from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { TICKET_STATUS_GROUP_KEYS } from '../ticket-status-groups';

export class TicketQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TicketStatus })
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @ApiPropertyOptional({
    description:
      'Dashboard-aligned status group. Ignored when `status` is provided.',
    enum: TICKET_STATUS_GROUP_KEYS,
  })
  @IsOptional()
  @IsIn([...TICKET_STATUS_GROUP_KEYS])
  statusGroup?: (typeof TICKET_STATUS_GROUP_KEYS)[number];

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
    description:
      'Optional filter: mine (own/assigned tickets) or all project tickets (default)',
    enum: ['mine', 'all'],
  })
  @IsOptional()
  @IsIn(['mine', 'all'])
  scope?: 'mine' | 'all';
}

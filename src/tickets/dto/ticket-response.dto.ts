import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  RoleType,
  TicketPriority,
  TicketStatus,
  TicketType,
} from '@prisma/client';
import { PaginatedResult } from '../../common/dto/pagination.dto';

export class TicketUserSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  fullName!: string;

  @ApiProperty({ nullable: true, type: String })
  email!: string | null;

  @ApiProperty({ enum: RoleType })
  role!: RoleType;
}

export class TicketHistoryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  action!: string;

  @ApiPropertyOptional({ enum: TicketStatus })
  fromStatus?: TicketStatus | null;

  @ApiPropertyOptional({ enum: TicketStatus })
  toStatus?: TicketStatus | null;

  @ApiPropertyOptional()
  metadata?: Record<string, unknown> | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ type: TicketUserSummaryDto })
  user!: TicketUserSummaryDto;
}

export class TicketResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  ticketNumber!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ enum: TicketType })
  type!: TicketType;

  @ApiProperty({ enum: TicketStatus })
  status!: TicketStatus;

  @ApiProperty({ enum: TicketPriority })
  priority!: TicketPriority;

  @ApiProperty()
  projectId!: string;

  @ApiPropertyOptional()
  sprintId?: string | null;

  @ApiProperty()
  createdById!: string;

  @ApiPropertyOptional()
  assignedToId?: string | null;

  @ApiPropertyOptional()
  verificationUserId?: string | null;

  @ApiPropertyOptional()
  resolvedAt?: string | null;

  @ApiPropertyOptional()
  closedAt?: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiProperty({ type: TicketUserSummaryDto })
  createdBy!: TicketUserSummaryDto;

  @ApiPropertyOptional({ type: TicketUserSummaryDto })
  assignedTo?: TicketUserSummaryDto | null;

  @ApiPropertyOptional({ type: TicketUserSummaryDto })
  verificationUser?: TicketUserSummaryDto | null;

  @ApiPropertyOptional({ enum: TicketStatus, isArray: true })
  availableTransitions?: TicketStatus[];

  @ApiPropertyOptional()
  project?: ProjectSummaryInTicketDto;

  @ApiPropertyOptional()
  sprint?: SprintSummaryInTicketDto | null;
}

export class ProjectSummaryInTicketDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  code!: string;
}

export class SprintSummaryInTicketDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  isActive!: boolean;
}

export class TicketDetailResponseDto extends TicketResponseDto {
  @ApiProperty({ type: [TicketHistoryDto] })
  histories!: TicketHistoryDto[];
}

export class PaginatedTicketsResponseDto implements PaginatedResult<TicketResponseDto> {
  @ApiProperty({ type: [TicketResponseDto] })
  items!: TicketResponseDto[];

  @ApiProperty()
  meta!: PaginatedResult<TicketResponseDto>['meta'];
}

export class AssigneeResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  fullName!: string;

  @ApiProperty({ nullable: true, type: String })
  email!: string | null;
}

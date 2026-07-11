import { ApiProperty } from '@nestjs/swagger';
import {
  TicketPriority,
  TicketStatus,
  TicketType,
} from '@prisma/client';

export class DashboardSummaryDto {
  @ApiProperty()
  totalTickets!: number;

  @ApiProperty()
  openTickets!: number;

  @ApiProperty()
  inProgressTickets!: number;

  @ApiProperty()
  resolvedTickets!: number;

  @ApiProperty()
  closedTickets!: number;

  @ApiProperty()
  unreadNotifications!: number;

  @ApiProperty({ required: false })
  totalUsers?: number;
}

export class DashboardCountItemDto {
  @ApiProperty()
  label!: string;

  @ApiProperty()
  count!: number;
}

export class DashboardTrendItemDto {
  @ApiProperty()
  date!: string;

  @ApiProperty()
  count!: number;
}

export class DashboardRecentTicketDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  ticketNumber!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ enum: TicketStatus })
  status!: TicketStatus;

  @ApiProperty({ enum: TicketPriority })
  priority!: TicketPriority;

  @ApiProperty({ enum: TicketType })
  type!: TicketType;

  @ApiProperty()
  createdAt!: string;
}

export class DashboardResponseDto {
  @ApiProperty({ type: DashboardSummaryDto })
  summary!: DashboardSummaryDto;

  @ApiProperty({ type: [DashboardCountItemDto] })
  ticketsByStatus!: DashboardCountItemDto[];

  @ApiProperty({ type: [DashboardCountItemDto] })
  ticketsByPriority!: DashboardCountItemDto[];

  @ApiProperty({ type: [DashboardCountItemDto] })
  ticketsByType!: DashboardCountItemDto[];

  @ApiProperty({ type: [DashboardTrendItemDto] })
  ticketsTrend!: DashboardTrendItemDto[];

  @ApiProperty({ type: [DashboardRecentTicketDto] })
  recentTickets!: DashboardRecentTicketDto[];
}

import { Injectable } from '@nestjs/common';
import {
  RoleType,
  TicketPriority,
  TicketStatus,
  TicketType,
} from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/auth.interface';
import { PrismaService } from '../prisma/prisma.service';
import { buildTicketScopeWhere } from '../tickets/ticket-scope.util';
import { getUserProjectIds } from '../projects/project-scope.util';
import { DashboardResponseDto } from './dto/dashboard-response.dto';

const OPEN_STATUSES: TicketStatus[] = [
  'OPEN',
  'USER_INPUT',
  'QA_REVIEW',
  'REOPENED',
];
const IN_PROGRESS_STATUSES: TicketStatus[] = [
  'ASSIGNED',
  'IN_PROGRESS',
  'WAITING_INFORMATION',
];
const CLOSED_STATUSES: TicketStatus[] = ['CLOSED', 'REJECTED'];

const ALL_STATUSES = Object.values(TicketStatus);
const ALL_PRIORITIES = Object.values(TicketPriority);
const ALL_TYPES = Object.values(TicketType);

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(currentUser: AuthenticatedUser): Promise<DashboardResponseDto> {
    const projectIds = await getUserProjectIds(
      this.prisma,
      currentUser.id,
      currentUser.role,
    );
    const ticketWhere = buildTicketScopeWhere(currentUser, projectIds);

    const [
      totalTickets,
      openTickets,
      inProgressTickets,
      resolvedTickets,
      closedTickets,
      unreadNotifications,
      statusGroups,
      priorityGroups,
      typeGroups,
      recentTickets,
      trendTickets,
      totalUsers,
    ] = await Promise.all([
      this.prisma.ticket.count({ where: ticketWhere }),
      this.prisma.ticket.count({
        where: { ...ticketWhere, status: { in: OPEN_STATUSES } },
      }),
      this.prisma.ticket.count({
        where: { ...ticketWhere, status: { in: IN_PROGRESS_STATUSES } },
      }),
      this.prisma.ticket.count({
        where: { ...ticketWhere, status: TicketStatus.RESOLVED },
      }),
      this.prisma.ticket.count({
        where: { ...ticketWhere, status: { in: CLOSED_STATUSES } },
      }),
      this.prisma.notification.count({
        where: { userId: currentUser.id, isRead: false },
      }),
      this.prisma.ticket.groupBy({
        by: ['status'],
        where: ticketWhere,
        _count: { status: true },
      }),
      this.prisma.ticket.groupBy({
        by: ['priority'],
        where: ticketWhere,
        _count: { priority: true },
      }),
      this.prisma.ticket.groupBy({
        by: ['type'],
        where: ticketWhere,
        _count: { type: true },
      }),
      this.prisma.ticket.findMany({
        where: ticketWhere,
        select: {
          id: true,
          ticketNumber: true,
          title: true,
          status: true,
          priority: true,
          type: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.ticket.findMany({
        where: {
          ...ticketWhere,
          createdAt: {
            gte: this.getTrendStartDate(),
          },
        },
        select: { createdAt: true },
      }),
      currentUser.role === RoleType.ADMIN
        ? this.prisma.user.count({
            where: { deletedAt: null, isActive: true },
          })
        : Promise.resolve(undefined),
    ]);

    return {
      summary: {
        totalTickets,
        openTickets,
        inProgressTickets,
        resolvedTickets,
        closedTickets,
        unreadNotifications,
        ...(totalUsers !== undefined ? { totalUsers } : {}),
      },
      ticketsByStatus: this.mapGroupedCounts(
        ALL_STATUSES,
        statusGroups.map((item) => ({
          key: item.status,
          count: item._count.status,
        })),
      ),
      ticketsByPriority: this.mapGroupedCounts(
        ALL_PRIORITIES,
        priorityGroups.map((item) => ({
          key: item.priority,
          count: item._count.priority,
        })),
      ),
      ticketsByType: this.mapGroupedCounts(
        ALL_TYPES,
        typeGroups.map((item) => ({
          key: item.type,
          count: item._count.type,
        })),
      ),
      ticketsTrend: this.buildTrend(trendTickets),
      recentTickets: recentTickets.map((ticket) => ({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        title: ticket.title,
        status: ticket.status,
        priority: ticket.priority,
        type: ticket.type,
        createdAt: ticket.createdAt.toISOString(),
      })),
    };
  }

  private getTrendStartDate(): Date {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - 6);
    return date;
  }

  private buildTrend(
    tickets: Array<{ createdAt: Date }>,
  ): Array<{ date: string; count: number }> {
    const counts = new Map<string, number>();

    for (let index = 0; index < 7; index += 1) {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (6 - index));
      counts.set(date.toISOString().slice(0, 10), 0);
    }

    for (const ticket of tickets) {
      const key = ticket.createdAt.toISOString().slice(0, 10);
      if (counts.has(key)) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }

    return [...counts.entries()].map(([date, count]) => ({ date, count }));
  }

  private mapGroupedCounts<T extends string>(
    allKeys: T[],
    groups: Array<{ key: T; count: number }>,
  ): Array<{ label: string; count: number }> {
    const countMap = new Map(groups.map((group) => [group.key, group.count]));

    return allKeys.map((key) => ({
      label: key,
      count: countMap.get(key) ?? 0,
    }));
  }
}

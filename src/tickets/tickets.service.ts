import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import {
  Prisma,
  RoleType,
  TicketPriority,
  TicketStatus,
  TicketType,
} from '@prisma/client';
import ExcelJS from 'exceljs';
import {
  buildPaginatedResult,
  PaginatedResult,
} from '../common/dto/pagination.dto';
import { AuthenticatedUser } from '../auth/interfaces/auth.interface';
import { NotificationsDispatchService } from '../notifications/notifications-dispatch.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import {
  TicketExportFormat,
  TicketExportQueryDto,
} from './dto/ticket-export-query.dto';
import { TicketQueryDto } from './dto/ticket-query.dto';
import {
  AssigneeResponseDto,
  TicketDetailResponseDto,
  TicketHistoryDto,
  TicketResponseDto,
  TicketUserSummaryDto,
} from './dto/ticket-response.dto';
import { UpdateTicketStatusDto } from './dto/update-ticket-status.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import {
  assertCanTransitionStatus,
  canEditTicketDetails,
  getAvailableTransitions,
} from './ticket-workflow';
import {
  assertTicketVisibleToUser,
  buildTicketScopeWhere,
} from './ticket-scope.util';
import { getUserProjectIds } from '../projects/project-scope.util';

type TicketWithRelations = Prisma.TicketGetPayload<{
  include: {
    createdBy: { include: { role: true } };
    assignedTo: { include: { role: true } };
    verificationUser: { include: { role: true } };
    project: true;
    sprint: true;
  };
}>;

type HistoryWithUser = Prisma.TicketHistoryGetPayload<{
  include: { user: { include: { role: true } } };
}>;

const userSummaryInclude = {
  role: true,
} as const;

const ticketInclude = {
  createdBy: { include: userSummaryInclude },
  assignedTo: { include: userSummaryInclude },
  verificationUser: { include: userSummaryInclude },
  project: true,
  sprint: true,
} as const;

@Injectable()
export class TicketsService {
  private readonly sortableFields = new Set([
    'createdAt',
    'updatedAt',
    'priority',
    'status',
    'ticketNumber',
    'title',
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsDispatch: NotificationsDispatchService,
  ) {}

  async findAll(
    query: TicketQueryDto,
    currentUser: AuthenticatedUser,
  ): Promise<PaginatedResult<TicketResponseDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;
    const sortBy = this.sortableFields.has(query.sortBy ?? '')
      ? (query.sortBy as string)
      : 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const where = await this.buildListWhere(query, currentUser);

    const [tickets, total] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({
        where,
        include: ticketInclude,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.ticket.count({ where }),
    ]);

    return buildPaginatedResult(
      tickets.map((ticket) =>
        this.mapTicket(ticket, currentUser.role, currentUser.id),
      ),
      total,
      page,
      limit,
    );
  }

  async findOne(
    id: string,
    currentUser: AuthenticatedUser,
  ): Promise<TicketDetailResponseDto> {
    const ticket = await this.findTicketOrThrow(id);
    await assertTicketVisibleToUser(this.prisma, currentUser, ticket);

    const histories = await this.prisma.ticketHistory.findMany({
      where: { ticketId: id },
      include: { user: { include: userSummaryInclude } },
      orderBy: { createdAt: 'desc' },
    });

    return {
      ...this.mapTicket(ticket, currentUser.role, currentUser.id),
      histories: histories.map((history) => this.mapHistory(history)),
    };
  }

  async create(
    dto: CreateTicketDto,
    currentUser: AuthenticatedUser,
  ): Promise<TicketResponseDto> {
    const { projectId, sprintId } = await this.resolveTicketProjectContext(
      dto,
      currentUser,
    );
    const ticketNumber = await this.generateTicketNumber(projectId, sprintId);
    const isUserSubmission = currentUser.role === RoleType.USER;

    const ticket = await this.prisma.$transaction(async (tx) => {
      const created = await tx.ticket.create({
        data: {
          ticketNumber,
          title: dto.title.trim(),
          description: dto.description.trim(),
          type: dto.type ?? TicketType.ISSUE_REPORT,
          priority: dto.priority ?? TicketPriority.MEDIUM,
          status: isUserSubmission ? TicketStatus.USER_INPUT : TicketStatus.OPEN,
          projectId,
          sprintId,
          createdById: currentUser.id,
        },
        include: ticketInclude,
      });

      await tx.ticketHistory.create({
        data: {
          ticketId: created.id,
          userId: currentUser.id,
          action: 'TICKET_CREATED',
          toStatus: created.status,
        },
      });

      return created;
    });

    void this.notificationsDispatch
      .notifyTicketCreated(this.toNotificationContext(ticket), currentUser.id)
      .catch(() => undefined);

    return this.mapTicket(ticket, currentUser.role, currentUser.id);
  }

  async update(
    id: string,
    dto: UpdateTicketDto,
    currentUser: AuthenticatedUser,
  ): Promise<TicketResponseDto> {
    const ticket = await this.findTicketOrThrow(id);
    await assertTicketVisibleToUser(this.prisma, currentUser, ticket);

    if (!canEditTicketDetails(currentUser.role, currentUser.id, ticket)) {
      throw new ForbiddenException('You cannot edit this ticket');
    }

    const data: Prisma.TicketUpdateInput = {};

    if (dto.title !== undefined) {
      data.title = dto.title.trim();
    }

    if (dto.description !== undefined) {
      data.description = dto.description.trim();
    }

    if (dto.type !== undefined) {
      data.type = dto.type;
    }

    if (dto.priority !== undefined) {
      data.priority = dto.priority;
    }

    if (dto.sprintId !== undefined) {
      if (
        currentUser.role !== RoleType.QA &&
        currentUser.role !== RoleType.ADMIN
      ) {
        throw new ForbiddenException('Only QA or admin can assign sprint');
      }

      if (dto.sprintId) {
        await this.validateSprintForProject(dto.sprintId, ticket.projectId);
        data.sprint = { connect: { id: dto.sprintId } };

        // Refresh ticket number when sprint is first assigned (CODE-SPRINT-seq)
        if (!ticket.sprintId || ticket.sprintId !== dto.sprintId) {
          data.ticketNumber = await this.generateTicketNumber(
            ticket.projectId,
            dto.sprintId,
            ticket.id,
          );
        }
      } else {
        data.sprint = { disconnect: true };
      }
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No fields to update');
    }

    if (currentUser.role === RoleType.QA && !ticket.managedById) {
      data.managedBy = { connect: { id: currentUser.id } };
    }


    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.ticket.update({
        where: { id },
        data,
        include: ticketInclude,
      });

      await tx.ticketHistory.create({
        data: {
          ticketId: id,
          userId: currentUser.id,
          action: 'TICKET_UPDATED',
          metadata: {
            fields: Object.keys(dto),
          },
        },
      });

      return result;
    });

    return this.mapTicket(updated, currentUser.role, currentUser.id);
  }

  async updateStatus(
    id: string,
    dto: UpdateTicketStatusDto,
    currentUser: AuthenticatedUser,
  ): Promise<TicketResponseDto> {
    const ticket = await this.findTicketOrThrow(id);
    await assertTicketVisibleToUser(this.prisma, currentUser, ticket);

    const nextStatus = dto.status;
    const accessTicket = {
      ...ticket,
      assignedToId:
        dto.assignedToId !== undefined
          ? dto.assignedToId
          : ticket.assignedToId,
    };

    if (nextStatus === TicketStatus.ASSIGNED && !dto.assignedToId) {
      throw new BadRequestException(
        'assignedToId is required when moving to ASSIGNED status',
      );
    }

    if (nextStatus === TicketStatus.RESOLVED && !dto.mentionUserId) {
      throw new BadRequestException(
        'mentionUserId is required when moving to RESOLVED — pilih user untuk uji ulang',
      );
    }

    let assigneeName: string | null = null;
    if (dto.assignedToId) {
      await this.validateAssignee(dto.assignedToId, ticket.projectId);
      const assignee = await this.prisma.user.findFirst({
        where: { id: dto.assignedToId },
        select: { fullName: true },
      });
      assigneeName = assignee?.fullName ?? null;
    }

    let mentionUser: {
      id: string;
      fullName: string;
      email: string | null;
    } | null = null;

    if (dto.mentionUserId) {
      mentionUser = await this.validateMentionUser(
        dto.mentionUserId,
        ticket.projectId,
      );
    }

    if (
      ticket.status === TicketStatus.USER_INPUT &&
      nextStatus === TicketStatus.QA_REVIEW &&
      !ticket.sprintId
    ) {
      throw new BadRequestException(
        'Sprint must be assigned before moving to QA Review',
      );
    }

    assertCanTransitionStatus(
      currentUser.role,
      currentUser.id,
      accessTicket,
      nextStatus,
    );

    const now = new Date();
    const data: Prisma.TicketUpdateInput = {
      status: nextStatus,
    };

    if (dto.assignedToId) {
      data.assignedTo = { connect: { id: dto.assignedToId } };
    }

    if (
      currentUser.role === RoleType.QA &&
      !ticket.managedById
    ) {
      data.managedBy = { connect: { id: currentUser.id } };
    }

    if (nextStatus === TicketStatus.RESOLVED && dto.mentionUserId) {
      data.verificationUser = { connect: { id: dto.mentionUserId } };
      data.resolvedAt = now;
    }

    if (nextStatus === TicketStatus.CLOSED) {
      data.closedAt = now;
    }

    if (nextStatus === TicketStatus.REOPENED) {
      data.resolvedAt = null;
      data.closedAt = null;
      data.verificationUser = { disconnect: true };
    }

    if (nextStatus === TicketStatus.IN_PROGRESS && ticket.status === TicketStatus.DONE) {
      data.resolvedAt = null;
      data.verificationUser = { disconnect: true };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.ticket.update({
        where: { id },
        data,
        include: ticketInclude,
      });

      await tx.ticketHistory.create({
        data: {
          ticketId: id,
          userId: currentUser.id,
          action: 'STATUS_CHANGED',
          fromStatus: ticket.status,
          toStatus: nextStatus,
          metadata: {
            note: dto.note,
            assignedToId: dto.assignedToId,
            assignedToName: assigneeName,
            actorName: currentUser.fullName,
            actorRole: currentUser.role,
            mentionUserId: dto.mentionUserId,
            mentionUserName: mentionUser?.fullName,
          },
        },
      });

      if (nextStatus === TicketStatus.RESOLVED && mentionUser) {
        const mentionTag = mentionUser.email
          ? `@${mentionUser.email}`
          : `@${mentionUser.fullName}`;
        await tx.ticketComment.create({
          data: {
            ticketId: id,
            userId: currentUser.id,
            content: `${mentionTag} mohon uji ulang tiket ini setelah perbaikan. Catatan QA: ${dto.note}`,
          },
        });
      }

      return result;
    });

    void this.notificationsDispatch
      .notifyTicketStatusChanged(
        this.toNotificationContext(updated),
        ticket.status,
        nextStatus,
        currentUser.id,
        dto.assignedToId,
        dto.mentionUserId,
      )
      .catch(() => undefined);

    return this.mapTicket(updated, currentUser.role, currentUser.id);
  }

  async remove(
    id: string,
    currentUser: AuthenticatedUser,
  ): Promise<{ message: string }> {
    const ticket = await this.findTicketOrThrow(id);

    if (currentUser.role !== RoleType.ADMIN) {
      throw new ForbiddenException('Only admins can delete tickets');
    }

    await this.prisma.$transaction([
      this.prisma.ticket.update({
        where: { id: ticket.id },
        data: { deletedAt: new Date() },
      }),
      this.prisma.ticketHistory.create({
        data: {
          ticketId: id,
          userId: currentUser.id,
          action: 'TICKET_DELETED',
          fromStatus: ticket.status,
        },
      }),
    ]);

    return { message: 'Ticket deleted successfully' };
  }

  async getAssignees(projectId?: string): Promise<AssigneeResponseDto[]> {
    const developers = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        role: { name: { in: [RoleType.DEVELOPER, RoleType.ADMIN] } },
        ...(projectId
          ? {
              userProjects: {
                some: {
                  projectId,
                  project: { deletedAt: null, isActive: true },
                },
              },
            }
          : {}),
      },
      select: {
        id: true,
        fullName: true,
        email: true,
      },
      orderBy: { fullName: 'asc' },
    });

    return developers.map((developer) => ({
      id: developer.id,
      fullName: developer.fullName,
      email: developer.email ?? '',
    }));
  }

  async getProjectMembers(projectId: string): Promise<AssigneeResponseDto[]> {
    const members = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        userProjects: {
          some: {
            projectId,
            project: { deletedAt: null, isActive: true },
          },
        },
      },
      select: {
        id: true,
        fullName: true,
        email: true,
      },
      orderBy: { fullName: 'asc' },
    });

    return members.map((member) => ({
      id: member.id,
      fullName: member.fullName,
      email: member.email ?? '',
    }));
  }

  async getReporters(
    currentUser: AuthenticatedUser,
  ): Promise<AssigneeResponseDto[]> {
    const projectIds = await getUserProjectIds(
      this.prisma,
      currentUser.id,
      currentUser.role,
    );

    const tickets = await this.prisma.ticket.findMany({
      where: {
        deletedAt: null,
        ...(projectIds !== 'all' ? { projectId: { in: projectIds } } : {}),
      },
      select: {
        createdById: true,
        createdBy: {
          select: { id: true, fullName: true, email: true },
        },
      },
    });

    const byId = new Map<
      string,
      { id: string; fullName: string; email: string }
    >();

    for (const ticket of tickets) {
      if (!byId.has(ticket.createdById)) {
        byId.set(ticket.createdById, {
          id: ticket.createdBy.id,
          fullName: ticket.createdBy.fullName,
          email: ticket.createdBy.email ?? '',
        });
      }
    }

    return [...byId.values()].sort((a, b) =>
      a.fullName.localeCompare(b.fullName),
    );
  }

  async exportBySprint(
    query: TicketExportQueryDto,
    currentUser: AuthenticatedUser,
  ): Promise<{ filename: string; contentType: string; file: StreamableFile }> {
    const sprint = await this.prisma.sprint.findFirst({
      where: { id: query.sprintId, deletedAt: null },
      include: {
        project: {
          select: { id: true, name: true, code: true, deletedAt: true },
        },
      },
    });

    if (!sprint || sprint.project.deletedAt) {
      throw new NotFoundException('Sprint not found');
    }

    const listQuery: TicketQueryDto = {
      sprintId: query.sprintId,
      projectId: sprint.projectId,
      page: 1,
      limit: 10_000,
      sortBy: 'createdAt',
      sortOrder: 'asc',
    };

    const where = await this.buildListWhere(listQuery, currentUser);

    const tickets = await this.prisma.ticket.findMany({
      where,
      include: {
        project: true,
        sprint: true,
        createdBy: { include: { role: true } },
        assignedTo: { include: { role: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const rows = tickets.map((ticket) => ({
      ticketNumber: ticket.ticketNumber,
      title: ticket.title,
      project: ticket.project.name,
      kode: ticket.project.code,
      sprint: ticket.sprint?.name ?? '',
      tipe: ticket.type,
      status: ticket.status,
      deskripsi: ticket.description,
      reporter: ticket.createdBy.fullName,
      assignee: ticket.assignedTo?.fullName ?? '',
      lastUpdate: ticket.updatedAt.toISOString(),
    }));

    const safeSprint = sprint.name.replace(/[^\w.-]+/g, '_');
    const safeProject = sprint.project.code.replace(/[^\w.-]+/g, '_');
    const format = query.format ?? TicketExportFormat.CSV;
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === TicketExportFormat.XLSX) {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'MyAssist';
      const sheet = workbook.addWorksheet('Tickets');
      sheet.columns = [
        { header: 'Ticket Number', key: 'ticketNumber', width: 16 },
        { header: 'Title', key: 'title', width: 28 },
        { header: 'Project', key: 'project', width: 22 },
        { header: 'Kode', key: 'kode', width: 12 },
        { header: 'Sprint', key: 'sprint', width: 16 },
        { header: 'Tipe', key: 'tipe', width: 18 },
        { header: 'Status', key: 'status', width: 18 },
        { header: 'Deskripsi', key: 'deskripsi', width: 40 },
        { header: 'Reporter', key: 'reporter', width: 20 },
        { header: 'Assignee', key: 'assignee', width: 20 },
        { header: 'Last Update', key: 'lastUpdate', width: 24 },
      ];
      sheet.getRow(1).font = { bold: true };
      sheet.addRows(rows);

      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
      return {
        filename: `tickets_${safeProject}_${safeSprint}_${stamp}.xlsx`,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        file: new StreamableFile(buffer),
      };
    }

    const headers = [
      'Ticket Number',
      'Title',
      'Project',
      'Kode',
      'Sprint',
      'Tipe',
      'Status',
      'Deskripsi',
      'Reporter',
      'Assignee',
      'Last Update',
    ];

    const csvLines = [
      headers.join(','),
      ...rows.map((row) =>
        [
          row.ticketNumber,
          row.title,
          row.project,
          row.kode,
          row.sprint,
          row.tipe,
          row.status,
          row.deskripsi,
          row.reporter,
          row.assignee,
          row.lastUpdate,
        ]
          .map((value) => this.escapeCsv(String(value ?? '')))
          .join(','),
      ),
    ];

    const csv = `\uFEFF${csvLines.join('\n')}`;
    return {
      filename: `tickets_${safeProject}_${safeSprint}_${stamp}.csv`,
      contentType: 'text/csv; charset=utf-8',
      file: new StreamableFile(Buffer.from(csv, 'utf8')),
    };
  }

  private escapeCsv(value: string): string {
    if (/[",\n\r]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  private async buildListWhere(
    query: TicketQueryDto,
    currentUser: AuthenticatedUser,
  ): Promise<Prisma.TicketWhereInput> {
    const projectIds = await getUserProjectIds(
      this.prisma,
      currentUser.id,
      currentUser.role,
    );

    const where: Prisma.TicketWhereInput = {
      ...buildTicketScopeWhere(currentUser, projectIds),
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.sprintId ? { sprintId: query.sprintId } : {}),
      ...(query.assignedToId ? { assignedToId: query.assignedToId } : {}),
      ...(query.createdById ? { createdById: query.createdById } : {}),
      ...(query.search
        ? {
            OR: [
              {
                title: { contains: query.search, mode: 'insensitive' },
              },
              {
                ticketNumber: { contains: query.search, mode: 'insensitive' },
              },
              {
                description: { contains: query.search, mode: 'insensitive' },
              },
            ],
          }
        : {}),
    };

    if (query.scope === 'mine') {
      if (currentUser.role === RoleType.DEVELOPER) {
        where.assignedToId = currentUser.id;
      } else if (currentUser.role === RoleType.USER) {
        where.createdById = currentUser.id;
      }
    }

    return where;
  }

  private async findTicketOrThrow(id: string): Promise<TicketWithRelations> {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id, deletedAt: null },
      include: ticketInclude,
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    return ticket;
  }

  private async validateAssignee(
    userId: string,
    projectId: string,
  ): Promise<void> {
    const assignee = await this.prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
        isActive: true,
        role: { name: { in: [RoleType.DEVELOPER, RoleType.ADMIN] } },
        OR: [
          { role: { name: RoleType.ADMIN } },
          {
            userProjects: {
              some: {
                projectId,
                project: { deletedAt: null, isActive: true },
              },
            },
          },
        ],
      },
    });

    if (!assignee) {
      throw new BadRequestException(
        'Invalid assignee. Must be a developer assigned to this project.',
      );
    }
  }

  private async validateMentionUser(
    userId: string,
    projectId: string,
  ): Promise<{ id: string; fullName: string; email: string | null }> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
        isActive: true,
        OR: [
          { role: { name: RoleType.ADMIN } },
          {
            userProjects: {
              some: {
                projectId,
                project: { deletedAt: null, isActive: true },
              },
            },
          },
        ],
      },
      select: { id: true, fullName: true, email: true },
    });

    if (!user) {
      throw new BadRequestException(
        'Invalid mention user. Must be an active member of this project.',
      );
    }

    return user;
  }

  private async resolveTicketProjectContext(
    dto: CreateTicketDto,
    currentUser: AuthenticatedUser,
  ): Promise<{ projectId: string; sprintId: string | null }> {
    let projectId = dto.projectId;

    if (currentUser.role === RoleType.USER) {
      const assignments = await this.prisma.userProject.findMany({
        where: {
          userId: currentUser.id,
          project: { deletedAt: null, isActive: true },
        },
        select: { projectId: true },
      });

      if (assignments.length !== 1) {
        throw new BadRequestException(
          'Your account must be linked to exactly one active project before creating tickets',
        );
      }

      return { projectId: assignments[0].projectId, sprintId: null };
    }

    if (!projectId) {
      throw new BadRequestException('projectId is required');
    }

    const projectIds = await getUserProjectIds(
      this.prisma,
      currentUser.id,
      currentUser.role,
    );

    if (projectIds !== 'all' && !projectIds.includes(projectId)) {
      throw new ForbiddenException('You do not have access to this project');
    }

    if (!dto.sprintId) {
      throw new BadRequestException('sprintId is required');
    }

    await this.validateSprintForProject(dto.sprintId, projectId);

    return { projectId, sprintId: dto.sprintId };
  }

  private async validateSprintForProject(
    sprintId: string,
    projectId: string,
  ): Promise<void> {
    const sprint = await this.prisma.sprint.findFirst({
      where: {
        id: sprintId,
        projectId,
        deletedAt: null,
        isActive: true,
        project: { deletedAt: null, isActive: true },
      },
    });

    if (!sprint) {
      throw new BadRequestException(
        'Invalid sprint. Sprint must be active and belong to the selected project',
      );
    }
  }

  private async generateTicketNumber(
    projectId: string,
    sprintId: string | null,
    excludeTicketId?: string,
  ): Promise<string> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { code: true },
    });

    if (!project) {
      throw new BadRequestException('Project not found');
    }

    const projectCode = project.code.trim().toUpperCase().replace(/\s+/g, '');
    let sprintKey = '0';

    if (sprintId) {
      const sprint = await this.prisma.sprint.findFirst({
        where: { id: sprintId, deletedAt: null },
        select: { name: true },
      });
      sprintKey = this.resolveSprintKey(sprint?.name ?? null);
    }

    const prefix = `${projectCode}-${sprintKey}-`;

    const lastTicket = await this.prisma.ticket.findFirst({
      where: {
        ticketNumber: { startsWith: prefix },
        ...(excludeTicketId ? { id: { not: excludeTicketId } } : {}),
      },
      orderBy: { ticketNumber: 'desc' },
      select: { ticketNumber: true },
    });

    const lastSeq = lastTicket
      ? Number.parseInt(lastTicket.ticketNumber.slice(prefix.length), 10)
      : 0;
    const nextSeq = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;

    return `${prefix}${String(nextSeq).padStart(7, '0')}`;
  }

  private resolveSprintKey(sprintName: string | null): string {
    if (!sprintName?.trim()) {
      return '0';
    }

    const match = sprintName.match(/(\d+)/);
    if (match?.[1]) {
      return match[1];
    }

    const sanitized = sprintName.replace(/[^\w]+/g, '').toUpperCase();
    return sanitized.slice(0, 8) || '0';
  }

  private mapUserSummary(
    user: {
      id: string;
      fullName: string;
      email: string | null;
      role?: { name: RoleType };
    },
  ): TicketUserSummaryDto {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email ?? '',
      role: user.role!.name,
    };
  }

  private mapTicket(
    ticket: TicketWithRelations,
    role: RoleType,
    userId: string,
  ): TicketResponseDto {
    return {
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      title: ticket.title,
      description: ticket.description,
      type: ticket.type,
      status: ticket.status,
      priority: ticket.priority,
      projectId: ticket.projectId,
      sprintId: ticket.sprintId,
      createdById: ticket.createdById,
      assignedToId: ticket.assignedToId,
      verificationUserId: ticket.verificationUserId,
      resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
      closedAt: ticket.closedAt?.toISOString() ?? null,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      createdBy: this.mapUserSummary(ticket.createdBy),
      assignedTo: ticket.assignedTo
        ? this.mapUserSummary(ticket.assignedTo)
        : null,
      verificationUser: ticket.verificationUser
        ? this.mapUserSummary(ticket.verificationUser)
        : null,
      project: {
        id: ticket.project.id,
        name: ticket.project.name,
        code: ticket.project.code,
      },
      sprint: ticket.sprint
        ? {
            id: ticket.sprint.id,
            name: ticket.sprint.name,
            isActive: ticket.sprint.isActive,
          }
        : null,
      availableTransitions: getAvailableTransitions(role, userId, ticket),
    };
  }

  private mapHistory(history: HistoryWithUser): TicketHistoryDto {
    return {
      id: history.id,
      action: history.action,
      fromStatus: history.fromStatus,
      toStatus: history.toStatus,
      metadata: history.metadata as Record<string, unknown> | null,
      createdAt: history.createdAt.toISOString(),
      user: this.mapUserSummary(history.user),
    };
  }

  private toNotificationContext(ticket: {
    id: string;
    ticketNumber: string;
    title: string;
    createdById: string;
    assignedToId: string | null;
    managedById?: string | null;
  }) {
    return {
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      title: ticket.title,
      createdById: ticket.createdById,
      assignedToId: ticket.assignedToId,
      managedById: ticket.managedById ?? null,
    };
  }
}

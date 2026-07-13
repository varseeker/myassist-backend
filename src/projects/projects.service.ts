import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RoleType } from '@prisma/client';
import {
  buildPaginatedResult,
  PaginatedResult,
} from '../common/dto/pagination.dto';
import { AuthenticatedUser } from '../auth/interfaces/auth.interface';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { CreateSprintDto } from './dto/create-sprint.dto';
import { ProjectQueryDto } from './dto/project-query.dto';
import {
  ProjectSummaryDto,
  SprintResponseDto,
} from './dto/project-response.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpdateSprintDto } from './dto/update-sprint.dto';
import {
  buildProjectFilter,
  getUserProjectIds,
} from './project-scope.util';

type ProjectRecord = Prisma.ProjectGetPayload<{
  include: { _count: { select: { sprints: true; userProjects: true } } };
}>;

type SprintRecord = Prisma.SprintGetPayload<Record<string, never>>;

const PROJECT_COUNT_INCLUDE = {
  _count: {
    select: {
      sprints: { where: { deletedAt: null } },
      userProjects: {
        where: {
          user: {
            deletedAt: null,
            isActive: true,
          },
        },
      },
    },
  },
} as const;

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: ProjectQueryDto,
    currentUser: AuthenticatedUser,
  ): Promise<PaginatedResult<ProjectSummaryDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;
    const projectIds = await getUserProjectIds(
      this.prisma,
      currentUser.id,
      currentUser.role,
    );

    const where: Prisma.ProjectWhereInput = {
      deletedAt: null,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...buildProjectFilter(projectIds),
    };

    const [projects, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        include: PROJECT_COUNT_INCLUDE,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.project.count({ where }),
    ]);

    return buildPaginatedResult(
      projects.map((project) => this.mapProject(project)),
      total,
      page,
      limit,
    );
  }

  async findOne(
    id: string,
    currentUser: AuthenticatedUser,
  ): Promise<ProjectSummaryDto> {
    await this.ensureProjectAccess(id, currentUser);
    const project = await this.findProjectOrThrow(id);
    return this.mapProject(project);
  }

  async create(dto: CreateProjectDto): Promise<ProjectSummaryDto> {
    const code = dto.code.trim().toUpperCase();
    const existing = await this.prisma.project.findFirst({
      where: {
        code,
        deletedAt: null,
      },
    });

    if (existing) {
      throw new ConflictException('Project code is already in use');
    }

    const project = await this.prisma.project.create({
      data: {
        name: dto.name.trim(),
        code,
        description: dto.description?.trim(),
        isActive: dto.isActive ?? true,
      },
      include: PROJECT_COUNT_INCLUDE,
    });

    return this.mapProject(project);
  }

  async update(id: string, dto: UpdateProjectDto): Promise<ProjectSummaryDto> {
    await this.findProjectOrThrow(id);

    if (dto.code) {
      const code = dto.code.trim().toUpperCase();
      const existing = await this.prisma.project.findFirst({
        where: {
          code,
          deletedAt: null,
          NOT: { id },
        },
      });

      if (existing) {
        throw new ConflictException('Project code is already in use');
      }
    }

    const project = await this.prisma.project.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.code !== undefined ? { code: dto.code.trim().toUpperCase() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description.trim() || null }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: PROJECT_COUNT_INCLUDE,
    });

    return this.mapProject(project);
  }

  async remove(id: string): Promise<{ message: string }> {
    await this.findProjectOrThrow(id);

    const openTickets = await this.prisma.ticket.count({
      where: {
        projectId: id,
        deletedAt: null,
        status: { notIn: ['CLOSED', 'REJECTED'] },
      },
    });

    if (openTickets > 0) {
      throw new BadRequestException(
        'Cannot delete a project that still has open tickets',
      );
    }

    await this.prisma.project.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    return { message: 'Project deleted successfully' };
  }

  async listSprints(
    projectId: string,
    currentUser: AuthenticatedUser,
    activeOnly = false,
  ): Promise<SprintResponseDto[]> {
    await this.ensureProjectAccess(projectId, currentUser);
    await this.findProjectOrThrow(projectId);

    const sprints = await this.prisma.sprint.findMany({
      where: {
        projectId,
        deletedAt: null,
        ...(activeOnly ? { isActive: true } : {}),
      },
      orderBy: [{ isActive: 'desc' }, { startDate: 'desc' }],
    });

    return sprints.map((sprint) => this.mapSprint(sprint));
  }

  async createSprint(
    projectId: string,
    dto: CreateSprintDto,
  ): Promise<SprintResponseDto> {
    await this.findProjectOrThrow(projectId);
    this.validateSprintDates(dto.startDate, dto.endDate);

    const sprint = await this.prisma.$transaction(async (tx) => {
      if (dto.isActive) {
        await tx.sprint.updateMany({
          where: { projectId, deletedAt: null, isActive: true },
          data: { isActive: false },
        });
      }

      return tx.sprint.create({
        data: {
          projectId,
          name: dto.name.trim(),
          goal: dto.goal?.trim(),
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
          isActive: dto.isActive ?? false,
        },
      });
    });

    return this.mapSprint(sprint);
  }

  async updateSprint(
    projectId: string,
    sprintId: string,
    dto: UpdateSprintDto,
  ): Promise<SprintResponseDto> {
    const sprint = await this.findSprintOrThrow(projectId, sprintId);

    if (dto.startDate || dto.endDate) {
      this.validateSprintDates(
        dto.startDate ?? sprint.startDate.toISOString(),
        dto.endDate ?? sprint.endDate.toISOString(),
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isActive) {
        await tx.sprint.updateMany({
          where: {
            projectId,
            deletedAt: null,
            isActive: true,
            NOT: { id: sprintId },
          },
          data: { isActive: false },
        });
      }

      return tx.sprint.update({
        where: { id: sprintId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.goal !== undefined ? { goal: dto.goal.trim() || null } : {}),
          ...(dto.startDate !== undefined
            ? { startDate: new Date(dto.startDate) }
            : {}),
          ...(dto.endDate !== undefined
            ? { endDate: new Date(dto.endDate) }
            : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
    });

    return this.mapSprint(updated);
  }

  async removeSprint(
    projectId: string,
    sprintId: string,
  ): Promise<{ message: string }> {
    await this.findSprintOrThrow(projectId, sprintId);

    const ticketCount = await this.prisma.ticket.count({
      where: { sprintId, deletedAt: null },
    });

    if (ticketCount > 0) {
      throw new BadRequestException(
        'Cannot delete a sprint that already has tickets',
      );
    }

    await this.prisma.sprint.update({
      where: { id: sprintId },
      data: { deletedAt: new Date(), isActive: false },
    });

    return { message: 'Sprint deleted successfully' };
  }

  async listMembers(
    projectId: string,
    currentUser: AuthenticatedUser,
  ): Promise<
    Array<{
      id: string;
      fullName: string;
      username: string;
      email: string | null;
      role: RoleType;
    }>
  > {
    await this.ensureProjectAccess(projectId, currentUser);
    await this.findProjectOrThrow(projectId);

    const members = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        userProjects: { some: { projectId } },
      },
      select: {
        id: true,
        fullName: true,
        username: true,
        email: true,
        role: { select: { name: true } },
      },
      orderBy: { fullName: 'asc' },
    });

    return members.map((member) => ({
      id: member.id,
      fullName: member.fullName,
      username: member.username,
      email: member.email,
      role: member.role.name,
    }));
  }

  async assignMember(
    projectId: string,
    userId: string,
    currentUser: AuthenticatedUser,
  ): Promise<{ message: string }> {
    if (
      currentUser.role !== RoleType.ADMIN &&
      currentUser.role !== RoleType.QA
    ) {
      throw new ForbiddenException(
        'Only admin or QA can assign users to projects',
      );
    }

    await this.ensureProjectAccess(projectId, currentUser);
    await this.findProjectOrThrow(projectId);

    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
      include: {
        role: true,
        userProjects: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role.name === RoleType.ADMIN) {
      throw new BadRequestException('Admin users are not tied to projects');
    }

    const alreadyMember = user.userProjects.some(
      (membership) => membership.projectId === projectId,
    );
    if (alreadyMember) {
      return { message: 'User is already a member of this project' };
    }

    if (user.role.name === RoleType.USER && user.userProjects.length > 0) {
      await this.prisma.$transaction([
        this.prisma.userProject.deleteMany({ where: { userId } }),
        this.prisma.userProject.create({
          data: { userId, projectId },
        }),
      ]);
      return {
        message:
          'User moved to this project (USER role allows one project only)',
      };
    }

    await this.prisma.userProject.create({
      data: { userId, projectId },
    });

    return { message: 'User assigned to project successfully' };
  }

  async listAssignableUsers(
    projectId: string,
    currentUser: AuthenticatedUser,
    search?: string,
  ): Promise<
    Array<{
      id: string;
      fullName: string;
      username: string;
      email: string | null;
      role: RoleType;
      projectCount: number;
    }>
  > {
    if (
      currentUser.role !== RoleType.ADMIN &&
      currentUser.role !== RoleType.QA
    ) {
      throw new ForbiddenException(
        'Only admin or QA can list assignable users',
      );
    }

    await this.ensureProjectAccess(projectId, currentUser);
    await this.findProjectOrThrow(projectId);

    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        role: { name: { not: RoleType.ADMIN } },
        userProjects: { none: { projectId } },
        ...(search
          ? {
              OR: [
                { fullName: { contains: search, mode: 'insensitive' } },
                { username: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        fullName: true,
        username: true,
        email: true,
        role: { select: { name: true } },
        _count: { select: { userProjects: true } },
      },
      orderBy: { fullName: 'asc' },
      take: 100,
    });

    return users.map((user) => ({
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      email: user.email,
      role: user.role.name,
      projectCount: user._count.userProjects,
    }));
  }

  async removeMember(
    projectId: string,
    userId: string,
    currentUser: AuthenticatedUser,
  ): Promise<{ message: string }> {
    if (
      currentUser.role !== RoleType.ADMIN &&
      currentUser.role !== RoleType.QA
    ) {
      throw new ForbiddenException(
        'Only admin or QA can remove users from projects',
      );
    }

    await this.ensureProjectAccess(projectId, currentUser);
    await this.findProjectOrThrow(projectId);

    const deleted = await this.prisma.userProject.deleteMany({
      where: { projectId, userId },
    });

    if (deleted.count === 0) {
      throw new NotFoundException('Project membership not found');
    }

    return { message: 'User removed from project successfully' };
  }

  private async ensureProjectAccess(
    projectId: string,
    currentUser: AuthenticatedUser,
  ): Promise<void> {
    if (currentUser.role === RoleType.ADMIN) {
      return;
    }

    const projectIds = await getUserProjectIds(
      this.prisma,
      currentUser.id,
      currentUser.role,
    );

    if (projectIds === 'all' || projectIds.includes(projectId)) {
      return;
    }

    throw new ForbiddenException('You do not have access to this project');
  }

  private async findProjectOrThrow(id: string): Promise<ProjectRecord> {
    const project = await this.prisma.project.findFirst({
      where: { id, deletedAt: null },
      include: PROJECT_COUNT_INCLUDE,
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return project;
  }

  private async findSprintOrThrow(
    projectId: string,
    sprintId: string,
  ): Promise<SprintRecord> {
    const sprint = await this.prisma.sprint.findFirst({
      where: {
        id: sprintId,
        projectId,
        deletedAt: null,
      },
    });

    if (!sprint) {
      throw new NotFoundException('Sprint not found');
    }

    return sprint;
  }

  private validateSprintDates(startDate: string, endDate: string): void {
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid sprint dates');
    }

    if (end < start) {
      throw new BadRequestException('Sprint end date must be after start date');
    }
  }

  private mapProject(project: ProjectRecord): ProjectSummaryDto {
    return {
      id: project.id,
      name: project.name,
      code: project.code,
      description: project.description,
      isActive: project.isActive,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      sprintCount: project._count.sprints,
      memberCount: project._count.userProjects,
    };
  }

  private mapSprint(sprint: SprintRecord): SprintResponseDto {
    return {
      id: sprint.id,
      projectId: sprint.projectId,
      name: sprint.name,
      goal: sprint.goal,
      startDate: sprint.startDate.toISOString(),
      endDate: sprint.endDate.toISOString(),
      isActive: sprint.isActive,
      createdAt: sprint.createdAt.toISOString(),
      updatedAt: sprint.updatedAt.toISOString(),
    };
  }
}

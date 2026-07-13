import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RoleType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import ExcelJS from 'exceljs';
import {
  buildPaginatedResult,
  PaginatedResult,
} from '../common/dto/pagination.dto';
import { createTelegramLinkToken, normalizePhoneNumber } from '../messaging/messaging.utils';
import { normalizeUsername } from '../common/utils/username.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  BulkImportUserRowResultDto,
  BulkImportUsersResponseDto,
} from './dto/bulk-import-users.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserQueryDto } from './dto/user-query.dto';
import { UserResponseDto } from './dto/user-response.dto';

type UserWithRole = Prisma.UserGetPayload<{
  include: {
    role: true;
    userProjects: { include: { project: true } };
  };
}>;

type BulkImportRow = {
  row: number;
  username: string;
  role: string;
  project: string;
};

const BULK_DEFAULT_PASSWORD = 'ChangeMe123!';
const VALID_IMPORT_ROLES = new Set<string>(Object.values(RoleType));

@Injectable()
export class UsersService {
  private readonly sortableFields = new Set([
    'createdAt',
    'fullName',
    'email',
    'username',
    'updatedAt',
  ]);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: UserQueryDto): Promise<PaginatedResult<UserResponseDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;
    const sortBy = this.sortableFields.has(query.sortBy ?? '')
      ? (query.sortBy as string)
      : 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.role ? { role: { name: query.role } } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search
        ? {
            OR: [
              {
                email: { contains: query.search, mode: 'insensitive' },
              },
              {
                username: { contains: query.search, mode: 'insensitive' },
              },
              {
                fullName: { contains: query.search, mode: 'insensitive' },
              },
            ],
          }
        : {}),
    };

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: {
          role: true,
          userProjects: { include: { project: true } },
        },
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.user.count({ where }),
    ]);

    return buildPaginatedResult(
      users.map((user) => this.mapUser(user)),
      total,
      page,
      limit,
    );
  }

  async findOne(id: string): Promise<UserResponseDto> {
    const user = await this.findUserOrThrow(id);
    return this.mapUser(user);
  }

  async create(dto: CreateUserDto): Promise<UserResponseDto> {
    const email = dto.email?.trim() ? dto.email.trim().toLowerCase() : null;
    const username = normalizeUsername(dto.username);

    const existingUser = await this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { username },
          ...(email ? [{ email }] : []),
        ],
      },
    });

    if (existingUser) {
      if (email && existingUser.email === email) {
        throw new ConflictException('Email is already registered');
      }
      throw new ConflictException('Username is already taken');
    }

    const role = await this.prisma.role.findFirst({
      where: { name: dto.role, deletedAt: null },
    });

    if (!role) {
      throw new BadRequestException('Invalid role');
    }

    await this.validateProjectAssignments(dto.role, dto.projectIds);

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const phoneNumber = this.normalizeOptionalPhone(dto.phoneNumber);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username,
          email,
          passwordHash,
          fullName: dto.fullName,
          avatarUrl: dto.avatarUrl,
          phoneNumber,
          whatsappEnabled: dto.whatsappEnabled ?? true,
          telegramChatId: dto.telegramChatId?.trim() || null,
          telegramEnabled: dto.telegramEnabled ?? true,
          telegramLinkToken: createTelegramLinkToken(),
          roleId: role.id,
        },
        include: {
          role: true,
          userProjects: { include: { project: true } },
        },
      });

      if (dto.projectIds?.length) {
        await tx.userProject.createMany({
          data: dto.projectIds.map((projectId) => ({
            userId: created.id,
            projectId,
          })),
        });
      }

      return tx.user.findFirstOrThrow({
        where: { id: created.id },
        include: {
          role: true,
          userProjects: { include: { project: true } },
        },
      });
    });

    return this.mapUser(user);
  }

  async bulkImport(
    file: Express.Multer.File,
  ): Promise<BulkImportUsersResponseDto> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('File is required');
    }

    const rows = await this.parseBulkImportFile(file);
    if (rows.length === 0) {
      throw new BadRequestException(
        'No data rows found. Expected columns: username, role, project',
      );
    }

    const results: BulkImportUserRowResultDto[] = [];
    let createdCount = 0;
    let errorCount = 0;

    for (const row of rows) {
      const result = await this.importSingleBulkRow(row);
      results.push(result);
      if (result.status === 'created') {
        createdCount += 1;
      } else {
        errorCount += 1;
      }
    }

    return {
      totalRows: rows.length,
      createdCount,
      errorCount,
      results,
    };
  }

  private async importSingleBulkRow(
    row: BulkImportRow,
  ): Promise<BulkImportUserRowResultDto> {
    const base = {
      row: row.row,
      username: row.username,
      role: row.role || undefined,
      project: row.project || undefined,
    };

    try {
      if (!row.username.trim()) {
        throw new BadRequestException('Username is required');
      }

      const username = normalizeUsername(row.username);
      const roleName = row.role.trim().toUpperCase();

      if (!VALID_IMPORT_ROLES.has(roleName)) {
        throw new BadRequestException(
          `Invalid role "${row.role}". Allowed: ${[...VALID_IMPORT_ROLES].join(', ')}`,
        );
      }

      const role = roleName as RoleType;
      const projectKey = row.project.trim();

      if (role === RoleType.ADMIN && projectKey) {
        throw new BadRequestException(
          'Admin users must leave the project column empty',
        );
      }

      if (role !== RoleType.ADMIN && !projectKey) {
        throw new BadRequestException(
          `Project is required for role ${role}`,
        );
      }

      let projectIds: string[] | undefined;
      if (projectKey) {
        const project = await this.prisma.project.findFirst({
          where: {
            deletedAt: null,
            isActive: true,
            OR: [
              { code: { equals: projectKey, mode: 'insensitive' } },
              { name: { equals: projectKey, mode: 'insensitive' } },
            ],
          },
          select: { id: true, code: true, name: true },
        });

        if (!project) {
          throw new BadRequestException(
            `Project "${projectKey}" not found or inactive`,
          );
        }

        projectIds = [project.id];
      }

      await this.validateProjectAssignments(role, projectIds);

      const existing = await this.prisma.user.findFirst({
        where: { username, deletedAt: null },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException(`Username "${username}" already exists`);
      }

      const roleRecord = await this.prisma.role.findFirst({
        where: { name: role, deletedAt: null },
      });
      if (!roleRecord) {
        throw new BadRequestException(`Role ${role} is not configured`);
      }

      const passwordHash = await bcrypt.hash(BULK_DEFAULT_PASSWORD, 12);
      const fullName = username;

      await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            username,
            email: null,
            passwordHash,
            fullName,
            roleId: roleRecord.id,
            telegramLinkToken: createTelegramLinkToken(),
          },
        });

        if (projectIds?.length) {
          await tx.userProject.createMany({
            data: projectIds.map((projectId) => ({
              userId: created.id,
              projectId,
            })),
          });
        }
      });

      return {
        ...base,
        username,
        status: 'created',
        message: 'User created successfully',
        temporaryPassword: BULK_DEFAULT_PASSWORD,
      };
    } catch (error) {
      let message = 'Failed to import row';
      if (error instanceof Error) {
        message = error.message;
      }
      return {
        ...base,
        status: 'error',
        message,
      };
    }
  }

  private async parseBulkImportFile(
    file: Express.Multer.File,
  ): Promise<BulkImportRow[]> {
    const originalName = (file.originalname || '').toLowerCase();
    const isCsv =
      originalName.endsWith('.csv') ||
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/csv';

    if (isCsv) {
      return this.parseBulkCsv(file.buffer.toString('utf8'));
    }

    if (
      originalName.endsWith('.xlsx') ||
      originalName.endsWith('.xls') ||
      file.mimetype.includes('spreadsheet') ||
      file.mimetype.includes('excel')
    ) {
      return this.parseBulkExcel(file.buffer);
    }

    throw new BadRequestException(
      'Unsupported file type. Upload a .csv or .xlsx file',
    );
  }

  private async parseBulkExcel(buffer: Buffer): Promise<BulkImportRow[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(buffer) as never);
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      return [];
    }

    const headerRow = sheet.getRow(1);
    const headers = [1, 2, 3].map((col) =>
      String(headerRow.getCell(col).text || '')
        .trim()
        .toLowerCase(),
    );

    this.assertBulkHeaders(headers);

    const rows: BulkImportRow[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const username = String(row.getCell(1).text || '').trim();
      const role = String(row.getCell(2).text || '').trim();
      const project = String(row.getCell(3).text || '').trim();
      if (!username && !role && !project) return;
      rows.push({ row: rowNumber, username, role, project });
    });

    return rows;
  }

  private parseBulkCsv(content: string): BulkImportRow[] {
    const lines = content
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      return [];
    }

    const headers = this.splitCsvLine(lines[0]!).map((h) => h.toLowerCase());
    this.assertBulkHeaders(headers);

    const rows: BulkImportRow[] = [];
    for (let i = 1; i < lines.length; i += 1) {
      const cols = this.splitCsvLine(lines[i]!);
      const username = (cols[0] ?? '').trim();
      const role = (cols[1] ?? '').trim();
      const project = (cols[2] ?? '').trim();
      if (!username && !role && !project) continue;
      rows.push({ row: i + 1, username, role, project });
    }

    return rows;
  }

  private assertBulkHeaders(headers: string[]): void {
    const normalized = headers.map((h) => h.replace(/[^a-z]/g, ''));
    if (
      normalized[0] !== 'username' ||
      normalized[1] !== 'role' ||
      normalized[2] !== 'project'
    ) {
      throw new BadRequestException(
        'Invalid header. Expected: username, role, project',
      );
    }
  }

  private splitCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i]!;
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
        continue;
      }
      current += char;
    }
    result.push(current);
    return result;
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    currentUserId: string,
  ): Promise<UserResponseDto> {
    const user = await this.findUserOrThrow(id);

    if (dto.isActive === false && id === currentUserId) {
      throw new BadRequestException('You cannot deactivate your own account');
    }

    if (dto.role && dto.role !== user.role.name) {
      await this.ensureAdminRemains(user, dto.role);
    }

    const data: Prisma.UserUpdateInput = {};

    if (dto.username !== undefined) {
      const username = normalizeUsername(dto.username);
      const taken = await this.prisma.user.findFirst({
        where: {
          username,
          deletedAt: null,
          NOT: { id },
        },
        select: { id: true },
      });
      if (taken) {
        throw new ConflictException('Username is already taken');
      }
      data.username = username;
    }

    if (dto.email !== undefined) {
      const email =
        dto.email === null || dto.email.trim() === ''
          ? null
          : dto.email.trim().toLowerCase();

      if (email) {
        const taken = await this.prisma.user.findFirst({
          where: {
            email,
            deletedAt: null,
            NOT: { id },
          },
          select: { id: true },
        });
        if (taken) {
          throw new ConflictException('Email is already registered');
        }
      }

      data.email = email;
    }

    if (dto.fullName !== undefined) {
      data.fullName = dto.fullName;
    }

    if (dto.avatarUrl !== undefined) {
      data.avatarUrl = dto.avatarUrl;
    }

    if (dto.phoneNumber !== undefined) {
      data.phoneNumber = this.normalizeOptionalPhone(dto.phoneNumber);
    }

    if (dto.whatsappEnabled !== undefined) {
      data.whatsappEnabled = dto.whatsappEnabled;
    }

    if (dto.telegramChatId !== undefined) {
      data.telegramChatId = dto.telegramChatId?.trim() || null;
    }

    if (dto.telegramEnabled !== undefined) {
      data.telegramEnabled = dto.telegramEnabled;
    }

    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, 12);
    }

    if (dto.role) {
      const role = await this.prisma.role.findFirst({
        where: { name: dto.role, deletedAt: null },
      });

      if (!role) {
        throw new BadRequestException('Invalid role');
      }

      data.role = { connect: { id: role.id } };
    }

    const nextRole = dto.role ?? user.role.name;
    if (dto.projectIds !== undefined) {
      await this.validateProjectAssignments(nextRole, dto.projectIds);
    }

    const updatedUser = await this.prisma.$transaction(async (tx) => {
      if (!user.telegramLinkToken) {
        data.telegramLinkToken = createTelegramLinkToken();
      }

      await tx.user.update({
        where: { id },
        data,
      });

      if (dto.projectIds !== undefined) {
        await tx.userProject.deleteMany({ where: { userId: id } });
        if (dto.projectIds.length > 0) {
          await tx.userProject.createMany({
            data: dto.projectIds.map((projectId) => ({
              userId: id,
              projectId,
            })),
          });
        }
      }

      return tx.user.findFirstOrThrow({
        where: { id },
        include: {
          role: true,
          userProjects: { include: { project: true } },
        },
      });
    });

    return this.mapUser(updatedUser);
  }

  async remove(id: string, currentUserId: string): Promise<{ message: string }> {
    if (id === currentUserId) {
      throw new BadRequestException('You cannot delete your own account');
    }

    const user = await this.findUserOrThrow(id);

    if (user.role.name === RoleType.ADMIN) {
      const adminCount = await this.prisma.user.count({
        where: {
          deletedAt: null,
          isActive: true,
          role: { name: RoleType.ADMIN },
        },
      });

      if (adminCount <= 1) {
        throw new BadRequestException('Cannot delete the last active admin');
      }
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      }),
      this.prisma.refreshToken.deleteMany({ where: { userId: id } }),
    ]);

    return { message: 'User deleted successfully' };
  }

  private async findUserOrThrow(id: string): Promise<UserWithRole> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: {
        role: true,
        userProjects: { include: { project: true } },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  private async ensureAdminRemains(
    user: UserWithRole,
    nextRole: RoleType,
  ): Promise<void> {
    if (user.role.name !== RoleType.ADMIN || nextRole === RoleType.ADMIN) {
      return;
    }

    const adminCount = await this.prisma.user.count({
      where: {
        deletedAt: null,
        isActive: true,
        role: { name: RoleType.ADMIN },
      },
    });

    if (adminCount <= 1) {
      throw new BadRequestException('Cannot change role of the last admin');
    }
  }

  private async validateProjectAssignments(
    role: RoleType,
    projectIds?: string[],
  ): Promise<void> {
    if (role === RoleType.ADMIN) {
      if (projectIds?.length) {
        throw new BadRequestException('Admin users are not tied to projects');
      }
      return;
    }

    if (role === RoleType.USER) {
      if (!projectIds?.length) {
        return;
      }
      if (projectIds.length > 1) {
        throw new BadRequestException(
          'User role must be assigned to at most one project',
        );
      }
    } else if (!projectIds?.length) {
      throw new BadRequestException(
        'At least one active project assignment is required',
      );
    }

    const projects = await this.prisma.project.findMany({
      where: {
        id: { in: projectIds },
        deletedAt: null,
        isActive: true,
      },
      select: { id: true },
    });

    if (projects.length !== projectIds.length) {
      throw new BadRequestException(
        'One or more selected projects are invalid or inactive',
      );
    }
  }

  private normalizeOptionalPhone(value?: string | null): string | null {
    if (value === undefined || value === null || value.trim() === '') {
      return null;
    }

    const normalized = normalizePhoneNumber(value);
    if (!normalized) {
      throw new BadRequestException('Invalid phone number format');
    }

    return normalized;
  }

  private mapUser(user: UserWithRole): UserResponseDto {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      phoneNumber: user.phoneNumber,
      whatsappEnabled: user.whatsappEnabled,
      telegramChatId: user.telegramChatId,
      telegramEnabled: user.telegramEnabled,
      telegramLinkToken: user.telegramLinkToken,
      role: user.role.name,
      roleId: user.role.id,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      projects: user.userProjects
        .filter((item) => item.project.deletedAt === null)
        .map((item) => ({
          id: item.project.id,
          name: item.project.name,
          code: item.project.code,
          isActive: item.project.isActive,
        })),
    };
  }
}

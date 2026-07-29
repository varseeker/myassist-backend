import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  buildPaginatedResult,
  PaginatedResult,
} from '../common/dto/pagination.dto';
import { StorageService } from '../storage/storage.service';
import { ClientQueryDto } from './dto/client-query.dto';
import { ClientResponseDto } from './dto/client-response.dto';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { PrismaService } from '../prisma/prisma.service';

const LOGO_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async findPublic(): Promise<ClientResponseDto[]> {
    const clients = await this.prisma.client.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return Promise.all(clients.map((client) => this.mapClient(client)));
  }

  async findAll(
    query: ClientQueryDto,
  ): Promise<PaginatedResult<ClientResponseDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.ClientWhereInput = {
      deletedAt: null,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    };

    const [clients, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.client.count({ where }),
    ]);

    const items = await Promise.all(
      clients.map((client) => this.mapClient(client)),
    );

    return buildPaginatedResult(items, total, page, limit);
  }

  async findOne(id: string): Promise<ClientResponseDto> {
    const client = await this.findActiveOrThrow(id);
    return this.mapClient(client);
  }

  async create(dto: CreateClientDto): Promise<ClientResponseDto> {
    const client = await this.prisma.client.create({
      data: {
        name: dto.name.trim(),
        companyName: dto.companyName?.trim() || null,
        description: dto.description.trim(),
        logoUrl: dto.logoUrl?.trim() || null,
        websiteUrl: dto.websiteUrl?.trim() || null,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });

    return this.mapClient(client);
  }

  async update(id: string, dto: UpdateClientDto): Promise<ClientResponseDto> {
    await this.findActiveOrThrow(id);

    const data: Prisma.ClientUpdateInput = {};

    if (dto.name !== undefined) {
      data.name = dto.name.trim();
    }
    if (dto.companyName !== undefined) {
      data.companyName = dto.companyName.trim() || null;
    }
    if (dto.description !== undefined) {
      data.description = dto.description.trim();
    }
    if (dto.logoUrl !== undefined) {
      data.logoUrl = dto.logoUrl.trim() || null;
    }
    if (dto.websiteUrl !== undefined) {
      data.websiteUrl = dto.websiteUrl.trim() || null;
    }
    if (dto.sortOrder !== undefined) {
      data.sortOrder = dto.sortOrder;
    }
    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    const updated = await this.prisma.client.update({
      where: { id },
      data,
    });

    return this.mapClient(updated);
  }

  async remove(id: string): Promise<{ message: string }> {
    const client = await this.findActiveOrThrow(id);

    if (client.logoPath) {
      await this.storage.remove(client.logoPath).catch(() => undefined);
    }

    await this.prisma.client.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    return { message: 'Client deleted successfully' };
  }

  async uploadLogo(
    id: string,
    file: Express.Multer.File | undefined,
  ): Promise<ClientResponseDto> {
    if (!file) {
      throw new BadRequestException('Logo file is required');
    }

    if (!LOGO_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        'Logo must be an image (jpeg, png, webp, gif, or svg)',
      );
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('Logo must be 5MB or smaller');
    }

    const client = await this.findActiveOrThrow(id);
    const extension = this.extensionFromMime(file.mimetype);
    const logoPath = `clients/${id}/${randomUUID()}${extension}`;

    await this.storage.upload(logoPath, file.buffer, file.mimetype);

    if (client.logoPath) {
      await this.storage.remove(client.logoPath).catch(() => undefined);
    }

    const updated = await this.prisma.client.update({
      where: { id },
      data: {
        logoPath,
        logoUrl: null,
      },
    });

    return this.mapClient(updated);
  }

  private async findActiveOrThrow(id: string) {
    const client = await this.prisma.client.findFirst({
      where: { id, deletedAt: null },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    return client;
  }

  private async mapClient(client: {
    id: string;
    name: string;
    companyName: string | null;
    description: string;
    logoUrl: string | null;
    logoPath: string | null;
    websiteUrl: string | null;
    sortOrder: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): Promise<ClientResponseDto> {
    let logoUrl = client.logoUrl;

    if (client.logoPath) {
      try {
        logoUrl = await this.storage.getSignedUrl(
          client.logoPath,
          60 * 60 * 24 * 7,
        );
      } catch {
        logoUrl = client.logoUrl;
      }
    }

    return {
      id: client.id,
      name: client.name,
      companyName: client.companyName,
      description: client.description,
      logoUrl,
      websiteUrl: client.websiteUrl,
      sortOrder: client.sortOrder,
      isActive: client.isActive,
      createdAt: client.createdAt.toISOString(),
      updatedAt: client.updatedAt.toISOString(),
    };
  }

  private extensionFromMime(mimeType: string): string {
    switch (mimeType) {
      case 'image/jpeg':
        return '.jpg';
      case 'image/png':
        return '.png';
      case 'image/webp':
        return '.webp';
      case 'image/gif':
        return '.gif';
      case 'image/svg+xml':
        return '.svg';
      default:
        return '';
    }
  }
}

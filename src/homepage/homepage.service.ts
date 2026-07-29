import { Injectable, NotFoundException } from '@nestjs/common';
import { HomepageSectionKey, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HOMEPAGE_SECTION_DEFAULTS } from './homepage-defaults';
import {
  HomepageSectionResponseDto,
  ReorderHomepageSectionsDto,
  UpdateHomepageSectionDto,
} from './dto/homepage.dto';

@Injectable()
export class HomepageService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureDefaults(): Promise<void> {
    for (const section of HOMEPAGE_SECTION_DEFAULTS) {
      await this.prisma.homepageSection.upsert({
        where: { key: section.key },
        update: {},
        create: {
          key: section.key,
          label: section.label,
          sortOrder: section.sortOrder,
          isVisible: true,
          content: section.content as Prisma.InputJsonValue,
        },
      });
    }
  }

  async findPublic(): Promise<HomepageSectionResponseDto[]> {
    await this.ensureDefaults();

    const sections = await this.prisma.homepageSection.findMany({
      where: { isVisible: true },
      orderBy: { sortOrder: 'asc' },
    });

    return sections.map((section) => this.mapSection(section));
  }

  async findAll(): Promise<HomepageSectionResponseDto[]> {
    await this.ensureDefaults();

    const sections = await this.prisma.homepageSection.findMany({
      orderBy: { sortOrder: 'asc' },
    });

    return sections.map((section) => this.mapSection(section));
  }

  async findOne(key: HomepageSectionKey): Promise<HomepageSectionResponseDto> {
    await this.ensureDefaults();

    const section = await this.prisma.homepageSection.findUnique({
      where: { key },
    });

    if (!section) {
      throw new NotFoundException('Homepage section not found');
    }

    return this.mapSection(section);
  }

  async update(
    key: HomepageSectionKey,
    dto: UpdateHomepageSectionDto,
  ): Promise<HomepageSectionResponseDto> {
    await this.ensureDefaults();

    const existing = await this.prisma.homepageSection.findUnique({
      where: { key },
    });

    if (!existing) {
      throw new NotFoundException('Homepage section not found');
    }

    const updated = await this.prisma.homepageSection.update({
      where: { key },
      data: {
        ...(dto.label !== undefined ? { label: dto.label.trim() } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isVisible !== undefined ? { isVisible: dto.isVisible } : {}),
        ...(dto.content !== undefined
          ? { content: dto.content as Prisma.InputJsonValue }
          : {}),
      },
    });

    return this.mapSection(updated);
  }

  async reorder(
    dto: ReorderHomepageSectionsDto,
  ): Promise<HomepageSectionResponseDto[]> {
    await this.ensureDefaults();

    await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.homepageSection.update({
          where: { key: item.key },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );

    return this.findAll();
  }

  async resetToDefault(
    key: HomepageSectionKey,
  ): Promise<HomepageSectionResponseDto> {
    const defaults = HOMEPAGE_SECTION_DEFAULTS.find(
      (section) => section.key === key,
    );

    if (!defaults) {
      throw new NotFoundException('Homepage section not found');
    }

    const updated = await this.prisma.homepageSection.upsert({
      where: { key },
      update: {
        label: defaults.label,
        sortOrder: defaults.sortOrder,
        isVisible: true,
        content: defaults.content as Prisma.InputJsonValue,
      },
      create: {
        key: defaults.key,
        label: defaults.label,
        sortOrder: defaults.sortOrder,
        isVisible: true,
        content: defaults.content as Prisma.InputJsonValue,
      },
    });

    return this.mapSection(updated);
  }

  private mapSection(section: {
    id: string;
    key: HomepageSectionKey;
    label: string;
    sortOrder: number;
    isVisible: boolean;
    content: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  }): HomepageSectionResponseDto {
    return {
      id: section.id,
      key: section.key,
      label: section.label,
      sortOrder: section.sortOrder,
      isVisible: section.isVisible,
      content: section.content,
      createdAt: section.createdAt.toISOString(),
      updatedAt: section.updatedAt.toISOString(),
    };
  }
}

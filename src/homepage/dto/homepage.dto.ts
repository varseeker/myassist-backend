import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HomepageSectionKey, Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class UpdateHomepageSectionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isVisible?: boolean;

  @ApiPropertyOptional({ description: 'Section content JSON' })
  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;
}

export class ReorderHomepageSectionItemDto {
  @ApiProperty({ enum: HomepageSectionKey })
  @IsEnum(HomepageSectionKey)
  key!: HomepageSectionKey;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder!: number;
}

export class ReorderHomepageSectionsDto {
  @ApiProperty({ type: [ReorderHomepageSectionItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderHomepageSectionItemDto)
  items!: ReorderHomepageSectionItemDto[];
}

export class HomepageSectionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: HomepageSectionKey })
  key!: HomepageSectionKey;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty()
  isVisible!: boolean;

  @ApiProperty()
  content!: Prisma.JsonValue;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

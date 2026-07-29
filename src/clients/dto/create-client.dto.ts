import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateClientDto {
  @ApiProperty({ example: 'Net Fashion Indonesia' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional({ example: 'PT NET PERSADA INDONESIA' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyName?: string;

  @ApiProperty({ example: 'Company description...' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description!: string;

  @ApiPropertyOptional({
    example: '/clients/net-fashion-indonesia.png',
    description: 'Public or absolute logo URL (used when logoPath is empty)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  logoUrl?: string;

  @ApiPropertyOptional({ example: 'https://example.com' })
  @IsOptional()
  @ValidateIf((_, value) => typeof value === 'string' && value.trim().length > 0)
  @IsUrl(
    { require_protocol: true },
    { message: 'websiteUrl must be a valid URL' },
  )
  @MaxLength(500)
  websiteUrl?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginatedResult } from '../../common/dto/pagination.dto';

export class ClientResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  companyName?: string | null;

  @ApiProperty()
  description!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Resolved logo URL for display',
  })
  logoUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  websiteUrl?: string | null;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class PaginatedClientsResponseDto
  implements PaginatedResult<ClientResponseDto>
{
  @ApiProperty({ type: [ClientResponseDto] })
  items!: ClientResponseDto[];

  @ApiProperty()
  meta!: PaginatedResult<ClientResponseDto>['meta'];
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginatedResult } from '../../common/dto/pagination.dto';

export class ProjectSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  code!: string;

  @ApiPropertyOptional()
  description?: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiPropertyOptional()
  sprintCount?: number;

  @ApiPropertyOptional()
  memberCount?: number;
}

export class SprintResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  projectId!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional()
  goal?: string | null;

  @ApiProperty()
  startDate!: string;

  @ApiProperty()
  endDate!: string;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class PaginatedProjectsResponseDto
  implements PaginatedResult<ProjectSummaryDto>
{
  @ApiProperty({ type: [ProjectSummaryDto] })
  items!: ProjectSummaryDto[];

  @ApiProperty()
  meta!: PaginatedResult<ProjectSummaryDto>['meta'];
}

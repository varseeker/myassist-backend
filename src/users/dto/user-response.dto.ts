import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RoleType } from '@prisma/client';
import { PaginatedResult } from '../../common/dto/pagination.dto';

export class UserProjectSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  isActive!: boolean;
}

export class UserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  fullName!: string;

  @ApiPropertyOptional()
  avatarUrl?: string | null;

  @ApiProperty({ enum: RoleType })
  role!: RoleType;

  @ApiProperty()
  roleId!: string;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiPropertyOptional({ type: [UserProjectSummaryDto] })
  projects?: UserProjectSummaryDto[];
}

export class PaginatedUsersResponseDto implements PaginatedResult<UserResponseDto> {
  @ApiProperty({ type: [UserResponseDto] })
  items!: UserResponseDto[];

  @ApiProperty()
  meta!: PaginatedResult<UserResponseDto>['meta'];
}

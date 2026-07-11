import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RoleType } from '@prisma/client';

export class RoleResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: RoleType })
  name!: RoleType;

  @ApiPropertyOptional()
  description?: string | null;
}

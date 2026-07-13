import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BulkImportUserRowResultDto {
  @ApiProperty()
  row!: number;

  @ApiProperty()
  username!: string;

  @ApiProperty({ enum: ['created', 'error'] })
  status!: 'created' | 'error';

  @ApiPropertyOptional()
  message?: string;

  @ApiPropertyOptional({
    description: 'Temporary password for newly created users',
  })
  temporaryPassword?: string;

  @ApiPropertyOptional()
  role?: string;

  @ApiPropertyOptional()
  project?: string;
}

export class BulkImportUsersResponseDto {
  @ApiProperty()
  totalRows!: number;

  @ApiProperty()
  createdCount!: number;

  @ApiProperty()
  errorCount!: number;

  @ApiProperty({ type: [BulkImportUserRowResultDto] })
  results!: BulkImportUserRowResultDto[];
}

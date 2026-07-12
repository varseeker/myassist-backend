import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export enum TicketExportFormat {
  CSV = 'csv',
  XLSX = 'xlsx',
}

export class TicketExportQueryDto {
  @ApiProperty({ description: 'Sprint ID to export tickets from' })
  @IsUUID()
  sprintId!: string;

  @ApiPropertyOptional({
    enum: TicketExportFormat,
    default: TicketExportFormat.CSV,
  })
  @IsOptional()
  @IsEnum(TicketExportFormat)
  format?: TicketExportFormat = TicketExportFormat.CSV;
}

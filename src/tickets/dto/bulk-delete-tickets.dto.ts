import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { TicketQueryDto } from './ticket-query.dto';

export class BulkDeleteTicketsDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Delete specific ticket IDs',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  ids?: string[];

  @ApiPropertyOptional({
    description:
      'When true with filter, delete all tickets matching the filter (admin confirmation)',
  })
  @IsOptional()
  @IsBoolean()
  deleteMatchingFilter?: boolean;

  @ApiPropertyOptional({
    description: 'Filter used when deleteMatchingFilter is true',
    type: TicketQueryDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TicketQueryDto)
  filter?: TicketQueryDto;
}

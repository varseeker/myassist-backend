import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationType } from '@prisma/client';
import { PaginatedResult } from '../../common/dto/pagination.dto';

export class NotificationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: NotificationType })
  type!: NotificationType;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  message!: string;

  @ApiPropertyOptional()
  data?: Record<string, unknown> | null;

  @ApiProperty()
  isRead!: boolean;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class PaginatedNotificationsResponseDto
  implements PaginatedResult<NotificationResponseDto>
{
  @ApiProperty({ type: [NotificationResponseDto] })
  items!: NotificationResponseDto[];

  @ApiProperty()
  meta!: PaginatedResult<NotificationResponseDto>['meta'];
}

export class UnreadCountResponseDto {
  @ApiProperty()
  count!: number;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RoleType } from '@prisma/client';
import { PaginatedResult } from '../../common/dto/pagination.dto';

export class CommentUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  fullName!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty({ nullable: true, type: String })
  email!: string | null;

  @ApiProperty({ enum: RoleType })
  role!: RoleType;
}

export class CommentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  ticketId!: string;

  @ApiProperty()
  content!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiProperty({ type: CommentUserDto })
  user!: CommentUserDto;

  @ApiProperty({ type: [CommentUserDto] })
  mentions!: CommentUserDto[];

  @ApiProperty()
  isEdited!: boolean;
}

export class PaginatedCommentsResponseDto
  implements PaginatedResult<CommentResponseDto>
{
  @ApiProperty({ type: [CommentResponseDto] })
  items!: CommentResponseDto[];

  @ApiProperty()
  meta!: PaginatedResult<CommentResponseDto>['meta'];
}

export class MentionableUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  fullName!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty({ nullable: true, type: String })
  email!: string | null;
}

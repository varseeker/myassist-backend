import { ApiProperty } from '@nestjs/swagger';
import { RoleType } from '@prisma/client';
import { PaginatedResult } from '../../common/dto/pagination.dto';

export class AttachmentUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  fullName!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: RoleType })
  role!: RoleType;
}

export class AttachmentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  ticketId!: string;

  @ApiProperty()
  fileName!: string;

  @ApiProperty()
  fileSize!: number;

  @ApiProperty()
  mimeType!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ type: AttachmentUserDto })
  uploadedBy!: AttachmentUserDto;
}

export class AttachmentDownloadResponseDto {
  @ApiProperty()
  url!: string;

  @ApiProperty()
  expiresIn!: number;

  @ApiProperty()
  fileName!: string;
}

export class PaginatedAttachmentsResponseDto
  implements PaginatedResult<AttachmentResponseDto>
{
  @ApiProperty({ type: [AttachmentResponseDto] })
  items!: AttachmentResponseDto[];

  @ApiProperty()
  meta!: PaginatedResult<AttachmentResponseDto>['meta'];
}

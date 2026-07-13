import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AssignProjectMemberDto {
  @ApiProperty({ description: 'User ID to assign to the project' })
  @IsUUID()
  userId!: string;
}

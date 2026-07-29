import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ example: 'OldPass123!' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  currentPassword!: string;

  @ApiProperty({ example: 'NewPass123!' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  newPassword!: string;
}

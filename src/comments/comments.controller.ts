import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/auth.interface';
import { CommentsService } from './comments.service';
import { CommentQueryDto } from './dto/comment-query.dto';
import {
  CommentResponseDto,
  MentionableUserDto,
  PaginatedCommentsResponseDto,
} from './dto/comment-response.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';

@ApiTags('Ticket Comments')
@ApiBearerAuth()
@Controller('tickets/:ticketId/comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Get()
  @ApiOperation({ summary: 'List comments on a ticket' })
  findAll(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Query() query: CommentQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<PaginatedCommentsResponseDto> {
    return this.commentsService.findAll(ticketId, query, currentUser);
  }

  @Get('mentionable-users')
  @ApiOperation({ summary: 'Search users that can be mentioned on this ticket' })
  getMentionableUsers(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Query('search') search: string | undefined,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<MentionableUserDto[]> {
    return this.commentsService.getMentionableUsers(
      ticketId,
      search,
      currentUser,
    );
  }

  @Post()
  @ApiOperation({ summary: 'Add a comment (use @email to mention users)' })
  create(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<CommentResponseDto> {
    return this.commentsService.create(ticketId, dto, currentUser);
  }

  @Patch(':commentId')
  @ApiOperation({ summary: 'Edit own comment' })
  update(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: UpdateCommentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<CommentResponseDto> {
    return this.commentsService.update(ticketId, commentId, dto, currentUser);
  }

  @Delete(':commentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete own comment (admin can delete any)' })
  remove(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ message: string }> {
    return this.commentsService.remove(ticketId, commentId, currentUser);
  }
}

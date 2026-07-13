import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/auth.interface';
import { NotificationQueryDto } from './dto/notification-query.dto';
import {
  NotificationResponseDto,
  PaginatedNotificationsResponseDto,
  UnreadCountResponseDto,
} from './dto/notification-response.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List notifications for the current user' })
  findAll(
    @Query() query: NotificationQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<PaginatedNotificationsResponseDto> {
    return this.notificationsService.findAll(currentUser.id, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count' })
  async getUnreadCount(
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<UnreadCountResponseDto> {
    const count = await this.notificationsService.getUnreadCount(currentUser.id);
    return { count };
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all notifications as read' })
  markAllAsRead(
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ message: string }> {
    return this.notificationsService.markAllAsRead(currentUser.id);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete all notifications for the current user' })
  removeAll(
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ message: string; deletedCount: number }> {
    return this.notificationsService.removeAll(currentUser.id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  markAsRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<NotificationResponseDto> {
    return this.notificationsService.markAsRead(currentUser.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a notification' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ message: string }> {
    return this.notificationsService.remove(currentUser.id, id);
  }
}

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
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { RoleType } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/auth.interface';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { TicketExportQueryDto } from './dto/ticket-export-query.dto';
import { TicketQueryDto } from './dto/ticket-query.dto';
import {
  AssigneeResponseDto,
  PaginatedTicketsResponseDto,
  TicketDetailResponseDto,
  TicketResponseDto,
} from './dto/ticket-response.dto';
import { UpdateTicketStatusDto } from './dto/update-ticket-status.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TicketsService } from './tickets.service';

@ApiTags('Tickets')
@ApiBearerAuth()
@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  @ApiOperation({ summary: 'List tickets with pagination and filters' })
  findAll(
    @Query() query: TicketQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<PaginatedTicketsResponseDto> {
    return this.ticketsService.findAll(query, currentUser);
  }

  @Get('assignees')
  @Roles(RoleType.ADMIN, RoleType.QA)
  @ApiOperation({ summary: 'List developers available for assignment' })
  getAssignees(
    @Query('projectId') projectId?: string,
  ): Promise<AssigneeResponseDto[]> {
    return this.ticketsService.getAssignees(projectId);
  }

  @Get('project-members')
  @Roles(RoleType.ADMIN, RoleType.QA, RoleType.DEVELOPER, RoleType.USER)
  @ApiOperation({ summary: 'List project members for verification mention' })
  getProjectMembers(
    @Query('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<AssigneeResponseDto[]> {
    return this.ticketsService.getProjectMembers(projectId);
  }

  @Get('reporters')
  @ApiOperation({ summary: 'List ticket reporters available for filtering' })
  getReporters(
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<AssigneeResponseDto[]> {
    return this.ticketsService.getReporters(currentUser);
  }

  @Get('export')
  @Roles(RoleType.ADMIN, RoleType.QA, RoleType.DEVELOPER)
  @ApiOperation({ summary: 'Export tickets for a sprint as CSV or Excel' })
  @ApiProduces(
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  async exportBySprint(
    @Query() query: TicketExportQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const result = await this.ticketsService.exportBySprint(query, currentUser);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    return result.file;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get ticket detail with history' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<TicketDetailResponseDto> {
    return this.ticketsService.findOne(id, currentUser);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new ticket' })
  create(
    @Body() dto: CreateTicketDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<TicketResponseDto> {
    return this.ticketsService.create(dto, currentUser);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update ticket details' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<TicketResponseDto> {
    return this.ticketsService.update(id, dto, currentUser);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update ticket status (workflow transition)' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketStatusDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<TicketResponseDto> {
    return this.ticketsService.updateStatus(id, dto, currentUser);
  }

  @Delete(':id')
  @Roles(RoleType.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete ticket (admin only)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ message: string }> {
    return this.ticketsService.remove(id, currentUser);
  }
}

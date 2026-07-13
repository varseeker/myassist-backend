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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RoleType } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/interfaces/auth.interface';
import { CreateProjectDto } from './dto/create-project.dto';
import { AssignProjectMemberDto } from './dto/assign-project-member.dto';
import { CreateSprintDto } from './dto/create-sprint.dto';
import { ProjectQueryDto } from './dto/project-query.dto';
import {
  PaginatedProjectsResponseDto,
  ProjectSummaryDto,
  SprintResponseDto,
} from './dto/project-response.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpdateSprintDto } from './dto/update-sprint.dto';
import { ProjectsService } from './projects.service';

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  @Roles(RoleType.ADMIN, RoleType.QA, RoleType.DEVELOPER, RoleType.USER)
  @ApiOperation({ summary: 'List projects available to the current user' })
  findAll(
    @Query() query: ProjectQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<PaginatedProjectsResponseDto> {
    return this.projectsService.findAll(query, currentUser);
  }

  @Get(':id')
  @Roles(RoleType.ADMIN, RoleType.QA, RoleType.DEVELOPER, RoleType.USER)
  @ApiOperation({ summary: 'Get project by ID' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<ProjectSummaryDto> {
    return this.projectsService.findOne(id, currentUser);
  }

  @Post()
  @Roles(RoleType.ADMIN)
  @ApiOperation({ summary: 'Create a new active project' })
  create(@Body() dto: CreateProjectDto): Promise<ProjectSummaryDto> {
    return this.projectsService.create(dto);
  }

  @Patch(':id')
  @Roles(RoleType.ADMIN)
  @ApiOperation({ summary: 'Update project details or active status' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<ProjectSummaryDto> {
    return this.projectsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(RoleType.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete project' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ message: string }> {
    return this.projectsService.remove(id);
  }

  @Get(':projectId/members')
  @Roles(RoleType.ADMIN, RoleType.QA)
  @ApiOperation({ summary: 'List members of a project' })
  listMembers(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.projectsService.listMembers(projectId, currentUser);
  }

  @Get(':projectId/assignable-users')
  @Roles(RoleType.ADMIN, RoleType.QA)
  @ApiOperation({ summary: 'List users that can be assigned to a project' })
  listAssignableUsers(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('search') search: string | undefined,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.projectsService.listAssignableUsers(
      projectId,
      currentUser,
      search,
    );
  }

  @Post(':projectId/members')
  @Roles(RoleType.ADMIN, RoleType.QA)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign a user to a project' })
  assignMember(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: AssignProjectMemberDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.projectsService.assignMember(
      projectId,
      dto.userId,
      currentUser,
    );
  }

  @Delete(':projectId/members/:userId')
  @Roles(RoleType.ADMIN, RoleType.QA)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a user from a project' })
  removeMember(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.projectsService.removeMember(projectId, userId, currentUser);
  }

  @Get(':projectId/sprints')
  @Roles(RoleType.ADMIN, RoleType.QA, RoleType.DEVELOPER, RoleType.USER)
  @ApiOperation({ summary: 'List sprints for a project' })
  listSprints(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('activeOnly') activeOnly: string | undefined,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<SprintResponseDto[]> {
    return this.projectsService.listSprints(
      projectId,
      currentUser,
      activeOnly === 'true',
    );
  }

  @Post(':projectId/sprints')
  @Roles(RoleType.ADMIN)
  @ApiOperation({ summary: 'Create sprint under a project' })
  createSprint(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateSprintDto,
  ): Promise<SprintResponseDto> {
    return this.projectsService.createSprint(projectId, dto);
  }

  @Patch(':projectId/sprints/:sprintId')
  @Roles(RoleType.ADMIN)
  @ApiOperation({ summary: 'Update sprint details or active status' })
  updateSprint(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('sprintId', ParseUUIDPipe) sprintId: string,
    @Body() dto: UpdateSprintDto,
  ): Promise<SprintResponseDto> {
    return this.projectsService.updateSprint(projectId, sprintId, dto);
  }

  @Delete(':projectId/sprints/:sprintId')
  @Roles(RoleType.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete sprint' })
  removeSprint(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('sprintId', ParseUUIDPipe) sprintId: string,
  ): Promise<{ message: string }> {
    return this.projectsService.removeSprint(projectId, sprintId);
  }
}

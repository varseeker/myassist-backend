import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { HomepageSectionKey, RoleType } from '@prisma/client';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  HomepageSectionResponseDto,
  ReorderHomepageSectionsDto,
  UpdateHomepageSectionDto,
} from './dto/homepage.dto';
import { HomepageService } from './homepage.service';

@ApiTags('Homepage CMS')
@Controller('homepage')
export class HomepageController {
  constructor(private readonly homepageService: HomepageService) {}

  @Public()
  @Get('public')
  @ApiOperation({ summary: 'Visible homepage sections for landing page' })
  findPublic(): Promise<HomepageSectionResponseDto[]> {
    return this.homepageService.findPublic();
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(RoleType.ADMIN)
  @ApiOperation({ summary: 'List all homepage sections (admin)' })
  findAll(): Promise<HomepageSectionResponseDto[]> {
    return this.homepageService.findAll();
  }

  @Patch('reorder')
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(RoleType.ADMIN)
  @ApiOperation({ summary: 'Reorder homepage sections' })
  reorder(
    @Body() dto: ReorderHomepageSectionsDto,
  ): Promise<HomepageSectionResponseDto[]> {
    return this.homepageService.reorder(dto);
  }

  @Get(':key')
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(RoleType.ADMIN)
  @ApiOperation({ summary: 'Get one homepage section' })
  findOne(
    @Param('key', new ParseEnumPipe(HomepageSectionKey)) key: HomepageSectionKey,
  ): Promise<HomepageSectionResponseDto> {
    return this.homepageService.findOne(key);
  }

  @Patch(':key')
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(RoleType.ADMIN)
  @ApiOperation({ summary: 'Update homepage section content / visibility' })
  update(
    @Param('key', new ParseEnumPipe(HomepageSectionKey)) key: HomepageSectionKey,
    @Body() dto: UpdateHomepageSectionDto,
  ): Promise<HomepageSectionResponseDto> {
    return this.homepageService.update(key, dto);
  }

  @Post(':key/reset')
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(RoleType.ADMIN)
  @ApiOperation({ summary: 'Reset section content to defaults' })
  reset(
    @Param('key', new ParseEnumPipe(HomepageSectionKey)) key: HomepageSectionKey,
  ): Promise<HomepageSectionResponseDto> {
    return this.homepageService.resetToDefault(key);
  }
}

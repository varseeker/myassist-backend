import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { OpsAlertService } from '../ops-alert/ops-alert.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly opsAlert: OpsAlertService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Health check endpoint' })
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      void this.opsAlert.alertDatabase(error);
      throw new ServiceUnavailableException({
        status: 'degraded',
        service: 'MyAssist API',
        database: 'disconnected',
        message: 'Database is unavailable',
        timestamp: new Date().toISOString(),
      });
    }

    return {
      status: 'ok',
      service: 'MyAssist API',
      database: 'connected',
      timestamp: new Date().toISOString(),
    };
  }
}

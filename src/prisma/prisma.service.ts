import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';

type OpsAlertLike = {
  alertDatabase: (error: unknown) => Promise<void>;
};

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly pool: Pool;

  constructor(
    configService: ConfigService,
    private readonly moduleRef: ModuleRef,
  ) {
    const connectionString = configService.getOrThrow<string>('DATABASE_URL');
    const pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
    const adapter = new PrismaPg(pool);

    super({ adapter });

    this.pool = pool;
  }

  async onModuleInit() {
    this.pool.on('error', (error) => {
      void this.getOpsAlert()?.alertDatabase(error);
    });

    try {
      await this.$connect();
    } catch (error) {
      void this.getOpsAlert()?.alertDatabase(error);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }

  /**
   * Lazy-resolve OpsAlertService to avoid a circular import with ops-alert.service.ts
   * (which depends on PrismaService).
   */
  private getOpsAlert(): OpsAlertLike | undefined {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { OpsAlertService } = require('../ops-alert/ops-alert.service') as {
        OpsAlertService: new (...args: never[]) => OpsAlertLike;
      };
      return this.moduleRef.get(OpsAlertService, { strict: false });
    } catch {
      return undefined;
    }
  }
}

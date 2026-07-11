import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';

export function createPrismaClient(connectionString?: string) {
  const url = connectionString ?? process.env.DATABASE_URL;

  if (!url) {
    throw new Error('DATABASE_URL is not defined');
  }

  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });

  const adapter = new PrismaPg(pool);

  return new PrismaClient({ adapter });
}

/**
 * Preflight for Render / CI: validate Supabase pooler URLs before migrate.
 * Catches the common "tenant/user ... not found" misconfiguration early.
 */
import 'dotenv/config';
import { Client } from 'pg';

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parsePgUrl(raw: string, label: string): URL {
  const value = stripWrappingQuotes(raw);
  try {
    return new URL(value.replace(/^postgresql:/i, 'http:'));
  } catch {
    throw new Error(`${label} is not a valid PostgreSQL connection URL`);
  }
}

function assertPoolerUsername(url: URL, label: string) {
  const user = decodeURIComponent(url.username);
  if (!user.startsWith('postgres.')) {
    throw new Error(
      `${label}: pooler username must be "postgres.<PROJECT_REF>" (got "${user}"). ` +
        `Copy the Session/Transaction string from Supabase → Connect → Connection pooling.`,
    );
  }
}

async function canConnect(label: string, connectionString: string) {
  const client = new Client({
    connectionString: stripWrappingQuotes(connectionString),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 12_000,
  });

  try {
    await client.connect();
    await client.query('SELECT 1 AS ok');
    console.log(`✓ ${label}: connected`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ ${label}: ${message.split('\n')[0]}`);
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const directUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('DATABASE_URL is missing in the environment.');
    process.exit(1);
  }

  if (!process.env.DIRECT_URL) {
    console.warn(
      '⚠ DIRECT_URL is missing — prisma migrate will fall back to DATABASE_URL. ' +
        'Set DIRECT_URL to the Session pooler (port 5432) for reliable migrations.',
    );
  }

  const db = parsePgUrl(databaseUrl, 'DATABASE_URL');
  const direct = parsePgUrl(directUrl!, 'DIRECT_URL');

  console.log('Checking database URL shape...\n');
  console.log(`DATABASE_URL host: ${db.hostname}:${db.port || '(default)'}`);
  console.log(`DIRECT_URL host:   ${direct.hostname}:${direct.port || '(default)'}`);
  console.log(`DATABASE_URL user: ${decodeURIComponent(db.username)}`);
  console.log(`DIRECT_URL user:   ${decodeURIComponent(direct.username)}\n`);

  if (db.hostname.includes('pooler.supabase.com')) {
    assertPoolerUsername(db, 'DATABASE_URL');
    if ((db.port || '5432') === '5432') {
      console.warn(
        '⚠ DATABASE_URL uses port 5432 (session). Prefer Transaction pooler port 6543 for runtime.',
      );
    }
  }

  if (direct.hostname.includes('pooler.supabase.com')) {
    assertPoolerUsername(direct, 'DIRECT_URL');
    if (direct.port === '6543') {
      console.error(
        'DIRECT_URL must NOT use Transaction pooler (6543). Use Session mode (5432) or Direct db.<ref>.supabase.co.',
      );
      process.exit(1);
    }
  }

  const okDirect = await canConnect('DIRECT_URL (migrations)', directUrl!);
  if (!okDirect) {
    console.error(`
============================================================
Supabase connection failed (tenant/user not found / ENOTFOUND)
============================================================
This is almost always an env var issue on Render — not Nest/Prisma code.

Fix:
1. Open Supabase Dashboard → your project (ensure it is NOT paused)
2. Click Connect → Connection pooling
3. Copy FRESH strings (host may be aws-0-... or aws-1-... — do not guess):
   - Session mode  :5432  → set as DIRECT_URL
   - Transaction   :6543  → set as DATABASE_URL (?pgbouncer=true)
4. Username must be postgres.<PROJECT_REF> on pooler hosts
5. If password has @ # % etc, URL-encode it
6. In Render: paste WITHOUT wrapping quotes
7. Locally verify: npm run db:test-connection

Project ref seen in this repo example: vkhyjuqmedclxzqulnsz
============================================================
`);
    process.exit(1);
  }

  // Runtime URL can be checked softly (migrate only needs DIRECT_URL).
  await canConnect('DATABASE_URL (runtime)', databaseUrl);
  console.log('\nDatabase preflight passed.');
}

void main();

import 'dotenv/config';
import { Client } from 'pg';

const projectRef = 'vkhyjuqmedclxzqulnsz';

function getPassword(): string {
  const source = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!source) {
    throw new Error('DIRECT_URL or DATABASE_URL is missing in .env');
  }

  const url = new URL(source.replace(/^postgresql:/, 'http:'));
  const password = decodeURIComponent(url.password);
  if (!password) {
    throw new Error('Could not read password from .env connection string');
  }
  return password;
}

const password = getPassword();

const regions = [
  'ap-southeast-1',
  'ap-southeast-2',
  'us-east-1',
  'us-west-1',
  'eu-central-1',
  'ap-northeast-1',
];

async function tryUrl(label: string, url: string) {
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query('SELECT 1');
    console.log(`OK: ${label}`);
    console.log('DIRECT_URL (migrations):');
    console.log(url.replace(password, '[YOUR-PASSWORD]'));
    console.log(
      'DATABASE_URL (runtime): sama, ganti port 6543 + tambah ?pgbouncer=true',
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL: ${label} -> ${message.split('\n')[0]}`);
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main() {
  console.log('Testing Supabase pooler (direct host IPv6 tidak bisa dijangkau)...\n');

  for (const region of regions) {
    for (const shard of ['aws-0', 'aws-1']) {
      const host = `${shard}-${region}.pooler.supabase.com`;
      const sessionUrl = `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@${host}:5432/postgres?sslmode=no-verify`;
      const ok = await tryUrl(`${shard}-${region} session :5432`, sessionUrl);
      if (ok) {
        return;
      }
    }
  }

  console.log('\nTidak ada pooler yang cocok.');
  console.log(
    'Buka Supabase Dashboard > Project Settings > Database > Connection Pooling',
  );
  console.log('Salin Session mode & Transaction mode (BUKAN Direct connection).');
  process.exit(1);
}

void main();

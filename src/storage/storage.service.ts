import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { mkdirSync } from 'fs';
import { join, normalize, resolve } from 'path';
import { unlink, writeFile } from 'fs/promises';
import {
  signLocalDownloadToken,
  verifyLocalDownloadToken,
} from './local-storage.util';

type StorageDriver = 'supabase' | 'local';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: StorageDriver;
  private readonly client: SupabaseClient | null;
  private readonly bucket: string;
  private readonly localRoot: string;
  private readonly signingSecret: string;
  private readonly appBaseUrl: string;
  private readonly apiPrefix: string;

  constructor(private readonly configService: ConfigService) {
    const serviceRoleKey = this.configService
      .get<string>('SUPABASE_SERVICE_ROLE_KEY')
      ?.trim();
    const configuredDriver = this.configService
      .get<string>('STORAGE_DRIVER')
      ?.trim()
      .toLowerCase();

    this.bucket = this.configService.get<string>(
      'SUPABASE_STORAGE_BUCKET',
      'ticket-attachments',
    );
    this.localRoot = resolve(
      process.cwd(),
      this.configService.get<string>('LOCAL_STORAGE_PATH', 'uploads'),
    );
    this.signingSecret =
      this.configService.get<string>('JWT_ACCESS_SECRET') ??
      'local-storage-dev-secret';
    this.apiPrefix = this.configService.get<string>('API_PREFIX', 'api/v1');
    const port = this.configService.get<string>('PORT', '3001');
    this.appBaseUrl = this.configService
      .get<string>('APP_URL', `http://localhost:${port}`)
      .replace(/\/$/, '');

    if (configuredDriver === 'local') {
      this.driver = 'local';
      this.client = null;
      return;
    }

    if (configuredDriver === 'supabase') {
      this.driver = 'supabase';
      this.client = this.createSupabaseClient(serviceRoleKey);
      return;
    }

    if (!serviceRoleKey) {
      if (this.configService.get<string>('NODE_ENV') === 'production') {
        throw new Error(
          'SUPABASE_SERVICE_ROLE_KEY is required in production. Copy the service_role key from Supabase Dashboard > Project Settings > API.',
        );
      }

      this.driver = 'local';
      this.client = null;
      return;
    }

    this.driver = 'supabase';
    this.client = this.createSupabaseClient(serviceRoleKey);
  }

  onModuleInit() {
    if (this.driver === 'local') {
      mkdirSync(this.localRoot, { recursive: true });
      this.logger.warn(
        `Using local filesystem storage at "${this.localRoot}". Set SUPABASE_SERVICE_ROLE_KEY to use Supabase Storage.`,
      );
      return;
    }

    void this.ensureBucketExists().catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'Unknown storage setup error';
      this.logger.error(
        `Supabase storage bucket "${this.bucket}" is not ready: ${message}. ` +
          'Create the bucket in Supabase Dashboard > Storage, or set STORAGE_DRIVER=local for development.',
      );
    });
  }

  getBucketName(): string {
    return this.bucket;
  }

  getDriver(): StorageDriver {
    return this.driver;
  }

  async upload(
    path: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<void> {
    if (this.driver === 'local') {
      const filePath = this.resolveLocalPath(path);
      mkdirSync(join(filePath, '..'), { recursive: true });
      await writeFile(filePath, buffer);
      return;
    }

    const error = await this.uploadToSupabase(path, buffer, mimeType);
    if (!error) {
      return;
    }

    if (this.isBucketMissingError(error)) {
      await this.ensureBucketExists();
      const retryError = await this.uploadToSupabase(path, buffer, mimeType);
      if (!retryError) {
        return;
      }
      throw new BadRequestException(
        `Failed to upload file: ${retryError.message}`,
      );
    }

    throw new BadRequestException(`Failed to upload file: ${error.message}`);
  }

  async getSignedUrl(path: string, expiresIn = 3600): Promise<string> {
    if (this.driver === 'local') {
      const token = signLocalDownloadToken(
        {
          path,
          exp: Date.now() + expiresIn * 1000,
        },
        this.signingSecret,
      );

      return `${this.appBaseUrl}/${this.apiPrefix}/storage/local?token=${encodeURIComponent(token)}`;
    }

    const { data, error } = await this.client!.storage
      .from(this.bucket)
      .createSignedUrl(path, expiresIn);

    if (error || !data?.signedUrl) {
      throw new BadRequestException(
        `Failed to generate download URL: ${error?.message ?? 'Unknown error'}`,
      );
    }

    return data.signedUrl;
  }

  async remove(path: string): Promise<void> {
    if (this.driver === 'local') {
      await unlink(this.resolveLocalPath(path)).catch(() => undefined);
      return;
    }

    const { error } = await this.client!.storage.from(this.bucket).remove([path]);

    if (error) {
      throw new BadRequestException(`Failed to delete file: ${error.message}`);
    }
  }

  verifyLocalDownloadToken(token: string): string {
    const payload = verifyLocalDownloadToken(token, this.signingSecret);
    return payload.path;
  }

  resolveLocalPath(path: string): string {
    const normalized = normalize(path).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = resolve(this.localRoot, normalized);

    if (!fullPath.startsWith(this.localRoot)) {
      throw new BadRequestException('Invalid file path');
    }

    return fullPath;
  }

  private async uploadToSupabase(
    path: string,
    buffer: Buffer,
    mimeType: string,
  ) {
    const { error } = await this.client!.storage
      .from(this.bucket)
      .upload(path, buffer, {
        contentType: mimeType,
        upsert: false,
      });

    return error;
  }

  private isBucketMissingError(error: { message?: string }): boolean {
    return error.message?.toLowerCase().includes('bucket not found') ?? false;
  }

  private async ensureBucketExists(): Promise<void> {
    const { data: existingBucket, error: getError } =
      await this.client!.storage.getBucket(this.bucket);

    if (existingBucket && !getError) {
      this.logger.log(`Supabase storage bucket "${this.bucket}" is ready`);
      return;
    }

    const { error: createError } = await this.client!.storage.createBucket(
      this.bucket,
      {
        public: false,
        fileSizeLimit: 10 * 1024 * 1024,
      },
    );

    if (createError) {
      const message = createError.message.toLowerCase();
      if (
        message.includes('already exists') ||
        message.includes('duplicate')
      ) {
        this.logger.log(`Supabase storage bucket "${this.bucket}" is ready`);
        return;
      }

      throw new Error(createError.message);
    }

    this.logger.log(`Created Supabase storage bucket "${this.bucket}"`);
  }

  private createSupabaseClient(serviceRoleKey?: string): SupabaseClient {
    const url = this.configService.get<string>('SUPABASE_URL')?.trim();

    if (!url) {
      throw new Error(
        'SUPABASE_URL is required when using Supabase storage. Set it in your .env file.',
      );
    }

    if (!serviceRoleKey) {
      throw new Error(
        'SUPABASE_SERVICE_ROLE_KEY is required when using Supabase storage. Copy the service_role key from Supabase Dashboard > Project Settings > API.',
      );
    }

    return createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
}

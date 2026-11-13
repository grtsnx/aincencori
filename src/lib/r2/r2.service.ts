import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Image types a browser may show in place. Everything else downloads, so a
// stored HTML or SVG file can never run as a page.
const inlineTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

// File storage on Cloudflare R2 (STORAGE_URL). R2 speaks the S3 protocol, so
// any S3-compatible store works too: locally the MinIO container from
// compose.yaml. Files are private; they are read through short-lived links.
// Tests keep files in memory, so they need no storage.
@Injectable()
export class R2Service implements OnModuleDestroy {
  private readonly logger = new Logger(R2Service.name);
  private readonly client?: S3Client;
  private readonly bucket: string = 'test';
  private readonly local: boolean = false;
  private bucketReady?: Promise<void>;
  // Tests only.
  private readonly memory = new Map<string, Uint8Array>();

  constructor(config: ConfigService) {
    if (config.get<string>('NODE_ENV') === 'test') return;
    // https://KEY:SECRET@host/bucket?region=auto
    const url = new URL(config.getOrThrow<string>('STORAGE_URL'));
    this.bucket = url.pathname.replace(/^\/+|\/+$/g, '');
    this.local = config.get<string>('NODE_ENV') !== 'production';
    this.client = new S3Client({
      endpoint: url.origin,
      region: url.searchParams.get('region') ?? 'auto',
      credentials: {
        accessKeyId: decodeURIComponent(url.username),
        secretAccessKey: decodeURIComponent(url.password),
      },
      // Needed by MinIO and fine for R2: the bucket goes in the path.
      forcePathStyle: true,
    });
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    if (!this.client) {
      this.memory.set(key, body);
      return;
    }
    await this.ready();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  // A private link to one file that works for a short time.
  async link(
    key: string,
    file: { name: string; contentType: string },
    seconds = 15 * 60,
  ): Promise<string> {
    if (!this.client) return `https://files.example.com/${key}`;
    const disposition = inlineTypes.has(file.contentType)
      ? 'inline'
      : 'attachment';
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: file.contentType,
        ResponseContentDisposition: `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      }),
      { expiresIn: seconds },
    );
  }

  async remove(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    if (!this.client) {
      for (const key of keys) this.memory.delete(key);
      return;
    }
    // The API takes up to 1000 keys per call.
    for (let i = 0; i < keys.length; i += 1_000) {
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: {
            Objects: keys.slice(i, i + 1_000).map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
    }
  }

  // Removes every file under a prefix (all of one user's files).
  async removePrefix(prefix: string): Promise<void> {
    if (!this.client) {
      for (const key of this.memory.keys()) {
        if (key.startsWith(prefix)) this.memory.delete(key);
      }
      return;
    }
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      await this.remove(
        (page.Contents ?? []).flatMap((item) => (item.Key ? [item.Key] : [])),
      );
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }

  // Health: throws when the storage does not answer.
  async ping(): Promise<void> {
    if (!this.client) return;
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  // Tests only: whether a file is stored.
  has(key: string): boolean {
    return this.memory.has(key);
  }

  onModuleDestroy(): void {
    this.client?.destroy();
  }

  // Local development only: makes the bucket the first time it is needed.
  // In production the bucket is created in the Cloudflare dashboard.
  private ready(): Promise<void> {
    if (!this.local || !this.client) return Promise.resolve();
    this.bucketReady ??= this.client
      .send(new HeadBucketCommand({ Bucket: this.bucket }))
      .then(() => undefined)
      .catch(async () => {
        await this.client?.send(
          new CreateBucketCommand({ Bucket: this.bucket }),
        );
        this.logger.log(`Created the local bucket "${this.bucket}".`);
      });
    return this.bucketReady;
  }
}

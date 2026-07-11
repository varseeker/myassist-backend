import { createHmac, timingSafeEqual } from 'crypto';

export interface LocalDownloadPayload {
  path: string;
  exp: number;
}

export function signLocalDownloadToken(
  payload: LocalDownloadPayload,
  secret: string,
): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${signature}`;
}

export function verifyLocalDownloadToken(
  token: string,
  secret: string,
): LocalDownloadPayload {
  const [data, signature] = token.split('.');

  if (!data || !signature) {
    throw new Error('Invalid download token');
  }

  const expectedSignature = createHmac('sha256', secret)
    .update(data)
    .digest('base64url');

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw new Error('Invalid download token');
  }

  const payload = JSON.parse(
    Buffer.from(data, 'base64url').toString('utf8'),
  ) as LocalDownloadPayload;

  if (!payload.path || typeof payload.exp !== 'number') {
    throw new Error('Invalid download token');
  }

  if (Date.now() > payload.exp) {
    throw new Error('Download link has expired');
  }

  return payload;
}

export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;

export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

export const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  ...ALLOWED_IMAGE_MIME_TYPES,
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

export function sanitizeFileName(fileName: string): string {
  return fileName
    .replace(/[^\w.\-() ]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 200);
}

export function buildAttachmentStoragePath(
  projectCode: string,
  sprintId: string | null,
  ticketId: string,
  attachmentId: string,
  fileName: string,
): string {
  const sprintSegment = sprintId ?? 'unassigned';
  return `${projectCode}/${sprintSegment}/${ticketId}/${attachmentId}/${fileName}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

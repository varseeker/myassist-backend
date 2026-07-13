import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export function buildDeletedUsername(username: string, id: string): string {
  const suffix = `_d${id.replace(/-/g, '').slice(0, 8)}`;
  const maxBase = Math.max(1, 32 - suffix.length);
  const base = username.replace(/_d[a-f0-9]{8}$/i, '').slice(0, maxBase);
  return `${base}${suffix}`.toLowerCase();
}

export function buildDeletedEmail(_email: string, id: string): string {
  const compactId = id.replace(/-/g, '').slice(0, 12);
  return `deleted+${compactId}@deleted.local`;
}

export function buildDeletedTelegramToken(id: string): string {
  return `del_${id.replace(/-/g, '')}`;
}

/**
 * Soft-deleted rows still occupy unique indexes (username/email/token).
 * Rename those deleted conflicts so values can be reused by active users.
 */
export async function releaseSoftDeletedUniqueConflicts(
  prisma: PrismaService,
  params: { username?: string; email?: string | null },
): Promise<void> {
  const orFilters: Prisma.UserWhereInput[] = [];
  if (params.username) {
    orFilters.push({ username: params.username });
  }
  if (params.email) {
    orFilters.push({ email: params.email });
  }
  if (orFilters.length === 0) {
    return;
  }

  const conflicts = await prisma.user.findMany({
    where: {
      deletedAt: { not: null },
      OR: orFilters,
    },
    select: {
      id: true,
      username: true,
      email: true,
    },
  });

  for (const conflict of conflicts) {
    await prisma.user.update({
      where: { id: conflict.id },
      data: {
        username: buildDeletedUsername(conflict.username, conflict.id),
        email: conflict.email
          ? buildDeletedEmail(conflict.email, conflict.id)
          : null,
        telegramLinkToken: buildDeletedTelegramToken(conflict.id),
        telegramChatId: null,
      },
    });
  }
}

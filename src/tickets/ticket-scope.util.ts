import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/auth.interface';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildTicketProjectScope,
  getUserProjectIds,
  ProjectScope,
} from '../projects/project-scope.util';
import {
  assertCanViewTicket,
  TicketAccessContext,
} from './ticket-workflow';

export function buildTicketScopeWhere(
  currentUser: AuthenticatedUser,
  projectIds: ProjectScope,
): Prisma.TicketWhereInput {
  return buildTicketProjectScope(currentUser, projectIds);
}

export async function assertTicketVisibleToUser(
  prisma: PrismaService,
  currentUser: AuthenticatedUser,
  ticket: TicketAccessContext,
): Promise<void> {
  const projectIds = await getUserProjectIds(
    prisma,
    currentUser.id,
    currentUser.role,
  );
  assertCanViewTicket(
    currentUser.role,
    currentUser.id,
    ticket,
    projectIds,
  );
}

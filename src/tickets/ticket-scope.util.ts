import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/auth.interface';
import {
  buildTicketProjectScope,
  ProjectScope,
} from '../projects/project-scope.util';

export function buildTicketScopeWhere(
  currentUser: AuthenticatedUser,
  projectIds: ProjectScope,
): Prisma.TicketWhereInput {
  return buildTicketProjectScope(currentUser, projectIds);
}

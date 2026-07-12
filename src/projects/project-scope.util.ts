import { RoleType, Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/auth.interface';
import { PrismaService } from '../prisma/prisma.service';

export type ProjectScope = string[] | 'all';

export async function getUserProjectIds(
  prisma: PrismaService,
  userId: string,
  role: RoleType,
): Promise<ProjectScope> {
  if (role === RoleType.ADMIN) {
    return 'all';
  }

  const assignments = await prisma.userProject.findMany({
    where: {
      userId,
      project: {
        deletedAt: null,
        isActive: true,
      },
    },
    select: { projectId: true },
  });

  return assignments.map((item) => item.projectId);
}

export function buildProjectFilter(
  projectIds: ProjectScope,
): Prisma.ProjectWhereInput | undefined {
  if (projectIds === 'all') {
    return undefined;
  }

  return { id: { in: projectIds } };
}

export function buildTicketProjectScope(
  _currentUser: AuthenticatedUser,
  projectIds: ProjectScope,
): Prisma.TicketWhereInput {
  const base: Prisma.TicketWhereInput = {
    deletedAt: null,
  };

  if (projectIds !== 'all') {
    base.projectId = { in: projectIds };
  }

  // All project members can see every ticket in their assigned projects.
  return base;
}


export async function assertUserHasProjectAccess(
  prisma: PrismaService,
  userId: string,
  role: RoleType,
  projectId: string,
): Promise<void> {
  if (role === RoleType.ADMIN) {
    return;
  }

  const assignment = await prisma.userProject.findFirst({
    where: {
      userId,
      projectId,
      project: { deletedAt: null, isActive: true },
    },
  });

  if (!assignment) {
    throw new Error('PROJECT_ACCESS_DENIED');
  }
}

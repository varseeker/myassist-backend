import { ForbiddenException } from '@nestjs/common';
import { RoleType, TicketStatus } from '@prisma/client';

export interface TicketAccessContext {
  id: string;
  status: TicketStatus;
  createdById: string;
  assignedToId: string | null;
  projectId: string;
  verificationUserId?: string | null;
}

const TERMINAL_STATUSES = new Set<TicketStatus>(['CLOSED', 'REJECTED']);

const TRANSITIONS: Record<
  TicketStatus,
  Partial<Record<TicketStatus, RoleType[]>>
> = {
  OPEN: {
    QA_REVIEW: [RoleType.QA, RoleType.ADMIN],
    REJECTED: [RoleType.QA, RoleType.ADMIN],
  },
  USER_INPUT: {
    QA_REVIEW: [RoleType.QA, RoleType.ADMIN],
    REJECTED: [RoleType.QA, RoleType.ADMIN],
  },
  QA_REVIEW: {
    ASSIGNED: [RoleType.QA, RoleType.ADMIN],
    REJECTED: [RoleType.QA, RoleType.ADMIN],
  },
  ASSIGNED: {
    IN_PROGRESS: [RoleType.DEVELOPER, RoleType.ADMIN],
  },
  IN_PROGRESS: {
    WAITING_INFORMATION: [RoleType.DEVELOPER, RoleType.QA, RoleType.ADMIN],
    DONE: [RoleType.DEVELOPER, RoleType.ADMIN],
  },
  WAITING_INFORMATION: {
    IN_PROGRESS: [
      RoleType.USER,
      RoleType.DEVELOPER,
      RoleType.QA,
      RoleType.ADMIN,
    ],
  },
  DONE: {
    RESOLVED: [RoleType.QA, RoleType.ADMIN],
    IN_PROGRESS: [RoleType.QA, RoleType.ADMIN],
  },
  RESOLVED: {
    CLOSED: [RoleType.USER, RoleType.QA, RoleType.ADMIN],
    REOPENED: [RoleType.USER, RoleType.QA, RoleType.ADMIN],
  },
  REOPENED: {
    QA_REVIEW: [RoleType.QA, RoleType.ADMIN],
  },
  CLOSED: {
    REOPENED: [RoleType.QA, RoleType.ADMIN, RoleType.USER],
  },
  REJECTED: {},
};

export function canViewTicket(
  role: RoleType,
  userId: string,
  ticket: TicketAccessContext,
  projectIds: string[] | 'all',
): boolean {
  if (role === RoleType.ADMIN || projectIds === 'all') {
    return true;
  }

  return projectIds.includes(ticket.projectId);
}

export function assertCanViewTicket(
  role: RoleType,
  userId: string,
  ticket: TicketAccessContext,
  projectIds: string[] | 'all',
): void {
  if (!canViewTicket(role, userId, ticket, projectIds)) {
    throw new ForbiddenException('You do not have access to this ticket');
  }
}

export function canTransitionStatus(
  role: RoleType,
  userId: string,
  ticket: TicketAccessContext,
  nextStatus: TicketStatus,
): boolean {
  if (ticket.status === nextStatus) {
    return false;
  }

  const allowedRoles = TRANSITIONS[ticket.status]?.[nextStatus];

  if (!allowedRoles?.includes(role)) {
    return false;
  }

  if (
    role === RoleType.USER &&
    (nextStatus === 'REOPENED' || nextStatus === 'CLOSED') &&
    ticket.createdById !== userId &&
    ticket.verificationUserId !== userId
  ) {
    return false;
  }

  if (
    role === RoleType.USER &&
    nextStatus === 'IN_PROGRESS' &&
    ticket.createdById !== userId
  ) {
    return false;
  }

  if (
    role === RoleType.DEVELOPER &&
    ['IN_PROGRESS', 'WAITING_INFORMATION', 'DONE'].includes(nextStatus) &&
    ticket.assignedToId !== userId
  ) {
    return false;
  }

  return true;
}

export function assertCanTransitionStatus(
  role: RoleType,
  userId: string,
  ticket: TicketAccessContext,
  nextStatus: TicketStatus,
): void {
  if (!canTransitionStatus(role, userId, ticket, nextStatus)) {
    throw new ForbiddenException(
      `Cannot transition ticket from ${ticket.status} to ${nextStatus}`,
    );
  }
}

export function canEditTicketDetails(
  role: RoleType,
  userId: string,
  ticket: TicketAccessContext,
): boolean {
  if (role === RoleType.ADMIN || role === RoleType.QA) {
    return !TERMINAL_STATUSES.has(ticket.status);
  }

  if (role === RoleType.DEVELOPER) {
    return (
      ticket.assignedToId === userId && !TERMINAL_STATUSES.has(ticket.status)
    );
  }

  if (role === RoleType.USER) {
    return (
      ticket.createdById === userId &&
      ['OPEN', 'USER_INPUT', 'WAITING_INFORMATION', 'REOPENED'].includes(
        ticket.status,
      )
    );
  }

  return false;
}

export function getAvailableTransitions(
  role: RoleType,
  userId: string,
  ticket: TicketAccessContext,
): TicketStatus[] {
  const candidates = Object.keys(
    TRANSITIONS[ticket.status] ?? {},
  ) as TicketStatus[];

  return candidates.filter((status) =>
    canTransitionStatus(role, userId, ticket, status),
  );
}

import { TicketStatus } from '@prisma/client';

export const TICKET_STATUS_GROUP_KEYS = [
  'open',
  'in_progress',
  'resolved',
  'closed',
] as const;

export type TicketStatusGroupKey = (typeof TICKET_STATUS_GROUP_KEYS)[number];

export const TICKET_STATUS_GROUPS: Record<TicketStatusGroupKey, TicketStatus[]> =
  {
    open: [
      TicketStatus.OPEN,
      TicketStatus.USER_INPUT,
      TicketStatus.QA_REVIEW,
      TicketStatus.REOPENED,
    ],
    in_progress: [
      TicketStatus.ASSIGNED,
      TicketStatus.IN_PROGRESS,
      TicketStatus.WAITING_INFORMATION,
      TicketStatus.DONE,
    ],
    resolved: [TicketStatus.RESOLVED],
    closed: [TicketStatus.CLOSED, TicketStatus.REJECTED],
  };

export function resolveTicketStatusFilter(params: {
  status?: TicketStatus;
  statusGroup?: TicketStatusGroupKey;
}): TicketStatus | { in: TicketStatus[] } | undefined {
  if (params.status) {
    return params.status;
  }

  if (params.statusGroup) {
    return { in: TICKET_STATUS_GROUPS[params.statusGroup] };
  }

  return undefined;
}

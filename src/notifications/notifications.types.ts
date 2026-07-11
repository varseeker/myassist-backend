import { NotificationType, Prisma } from '@prisma/client';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Prisma.InputJsonValue;
}

export interface TicketNotificationContext {
  id: string;
  ticketNumber: string;
  title: string;
  createdById: string;
  assignedToId: string | null;
}

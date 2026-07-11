import type { RoleType } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  email: string;
  role: RoleType;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  roleId: string;
  role: RoleType;
  isActive: boolean;
}

export const REFRESH_TOKEN_COOKIE = 'myassist_refresh_token';

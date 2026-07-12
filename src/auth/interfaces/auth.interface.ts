import type { RoleType } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  username: string;
  email: string | null;
  role: RoleType;
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  email: string | null;
  fullName: string;
  roleId: string;
  role: RoleType;
  isActive: boolean;
}

export const REFRESH_TOKEN_COOKIE = 'myassist_refresh_token';

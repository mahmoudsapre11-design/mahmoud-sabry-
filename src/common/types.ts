import { Prisma, Role } from '@prisma/client';

export interface AuthUser {
  id: number;
  email: string;
  role: Role;
}

// Never select the password column in any API response
export const safeUserSelect = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  role: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export function buildMeta(total: number, page: number, limit: number) {
  return { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';

export interface AuthUser {
  id: string;
  accountType: string;
  name: string;
  email: string;
  company: string | null;
  role: string;
  isActive: boolean;
  approved: boolean;
  allowedVerticals: string[];
  allowedLocations: string[];
  userPermissions: Record<string, boolean>;
  inventoryPermissions: Record<string, boolean>;
  menuPermissions: Record<string, boolean> | string[];
  modulePermissions: Record<string, boolean> | string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

interface JwtPayload {
  sub: string;
  accountType: string;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asPermissionMap(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(value)) {
    result[k] = Boolean(v);
  }
  return result;
}

export function sanitizeUser(user: {
  id: string;
  accountType: string;
  name: string;
  email: string;
  company: string | null;
  role: string;
  isActive: boolean;
  approved: boolean;
  allowedVerticals: unknown;
  allowedLocations: unknown;
  userPermissions: unknown;
  inventoryPermissions: unknown;
  menuPermissions: unknown;
  modulePermissions: unknown;
  createdAt?: Date;
  updatedAt?: Date;
}): AuthUser & { createdAt?: Date; updatedAt?: Date } {
  return {
    id: user.id,
    accountType: user.accountType,
    name: user.name,
    email: user.email,
    company: user.company,
    role: user.role,
    isActive: user.isActive,
    approved: user.approved,
    allowedVerticals: asStringArray(user.allowedVerticals),
    allowedLocations: asStringArray(user.allowedLocations),
    userPermissions: asPermissionMap(user.userPermissions),
    inventoryPermissions: asPermissionMap(user.inventoryPermissions),
    menuPermissions: Array.isArray(user.menuPermissions)
      ? asStringArray(user.menuPermissions)
      : asPermissionMap(user.menuPermissions),
    modulePermissions: Array.isArray(user.modulePermissions)
      ? asStringArray(user.modulePermissions)
      : asPermissionMap(user.modulePermissions),
    ...(user.createdAt ? { createdAt: user.createdAt } : {}),
    ...(user.updatedAt ? { updatedAt: user.updatedAt } : {}),
  };
}

/**
 * Verifies JWT and loads live user state from DB so Admin deactivation
 * or permission revocation takes effect immediately.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError(401, 'Missing or invalid authorization header');
    }

    const token = authHeader.slice('Bearer '.length).trim();
    const payload = jwt.verify(token, env.jwtSecret) as JwtPayload;

    const dbUser = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!dbUser) {
      throw new AppError(401, 'User session is no longer valid');
    }

    if (!dbUser.isActive) {
      throw new AppError(403, 'Account is inactive. Contact your administrator.');
    }

    req.user = sanitizeUser(dbUser);
    next();
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
      next(new AppError(401, 'Invalid or expired token'));
      return;
    }
    next(err);
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new AppError(401, 'Authentication required'));
    return;
  }
  if (req.user.accountType !== 'Admin') {
    next(new AppError(403, 'Admin access required'));
    return;
  }
  next();
}

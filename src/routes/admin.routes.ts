import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { authenticate, requireAdmin, sanitizeUser } from '../middleware/auth';
import {
  createVendorSchema,
  updateVendorPermissionsSchema,
  updateVendorStatusSchema,
} from '../validators/auth.validator';

export const adminRouter = Router();

adminRouter.use(authenticate, requireAdmin);

adminRouter.get('/vendors', async (req, res, next) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
    const accountType =
      typeof req.query.accountType === 'string' ? req.query.accountType : undefined;

    const where: Prisma.UserWhereInput = {
      ...(accountType ? { accountType } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { email: { contains: search } },
              { company: { contains: search } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      items: items.map(sanitizeUser),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/vendors', async (req, res, next) => {
  try {
    const data = createVendorSchema.parse(req.body);
    const normalizedEmail = data.email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      throw new AppError(409, 'A user with this email already exists');
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    const created = await prisma.user.create({
      data: {
        accountType: 'Vendor',
        name: data.name,
        email: normalizedEmail,
        passwordHash,
        company: data.company ?? null,
        role: data.role,
        isActive: data.isActive,
        approved: data.approved,
        allowedVerticals: data.allowedVerticals,
        allowedLocations: data.allowedLocations,
        userPermissions: data.userPermissions,
        inventoryPermissions: data.inventoryPermissions,
        menuPermissions: data.menuPermissions,
        modulePermissions: data.modulePermissions,
      },
    });

    res.status(201).json({ vendor: sanitizeUser(created) });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch('/vendors/:id/status', async (req, res, next) => {
  try {
    const { isActive } = updateVendorStatusSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });

    if (!existing) {
      throw new AppError(404, 'Vendor not found');
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive },
    });

    res.json({ vendor: sanitizeUser(updated) });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch('/vendors/:id/permissions', async (req, res, next) => {
  try {
    const data = updateVendorPermissionsSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });

    if (!existing) {
      throw new AppError(404, 'Vendor not found');
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...(data.allowedVerticals !== undefined
          ? { allowedVerticals: data.allowedVerticals }
          : {}),
        ...(data.allowedLocations !== undefined
          ? { allowedLocations: data.allowedLocations }
          : {}),
        ...(data.userPermissions !== undefined
          ? { userPermissions: data.userPermissions }
          : {}),
        ...(data.inventoryPermissions !== undefined
          ? { inventoryPermissions: data.inventoryPermissions }
          : {}),
        ...(data.menuPermissions !== undefined
          ? { menuPermissions: data.menuPermissions }
          : {}),
        ...(data.modulePermissions !== undefined
          ? { modulePermissions: data.modulePermissions }
          : {}),
      },
    });

    res.json({ vendor: sanitizeUser(updated) });
  } catch (err) {
    next(err);
  }
});

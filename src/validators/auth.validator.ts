import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  accountType: z.enum(['Admin', 'Vendor']).optional(),
});

export const createVendorSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  company: z.string().optional(),
  role: z.string().default('Vendor'),
  isActive: z.boolean().default(true),
  approved: z.boolean().default(true),
  allowedVerticals: z.array(z.enum(['Grocery', 'Pharmacy', 'Mall'])).default([]),
  allowedLocations: z.array(z.string()).default([]),
  userPermissions: z.record(z.boolean()).default({}),
  inventoryPermissions: z.record(z.boolean()).default({
    view: true,
    create: false,
    edit: false,
    stockAdjust: false,
    export: false,
  }),
  menuPermissions: z.union([z.record(z.boolean()), z.array(z.string())]).default({}),
  modulePermissions: z.union([z.record(z.boolean()), z.array(z.string())]).default({}),
});

export const updateVendorStatusSchema = z.object({
  isActive: z.boolean(),
});

export const updateVendorPermissionsSchema = z.object({
  allowedVerticals: z.array(z.enum(['Grocery', 'Pharmacy', 'Mall'])).optional(),
  allowedLocations: z.array(z.string()).optional(),
  userPermissions: z.record(z.boolean()).optional(),
  inventoryPermissions: z.record(z.boolean()).optional(),
  menuPermissions: z.union([z.record(z.boolean()), z.array(z.string())]).optional(),
  modulePermissions: z.union([z.record(z.boolean()), z.array(z.string())]).optional(),
});

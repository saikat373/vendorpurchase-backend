import { Router } from 'express';
import { AppError } from '../lib/errors';
import { authenticate, AuthUser } from '../middleware/auth';
import * as inventoryService from '../services/inventory.service';
import {
  createProductSchema,
  inventoryQuerySchema,
  stockMovementSchema,
  updateProductSchema,
} from '../validators/inventory.validator';

export const inventoryRouter = Router();

inventoryRouter.use(authenticate);

const PERMISSION_ALIASES: Record<string, string[]> = {
  view: ['view', 'viewInventory', 'viewStock', 'viewStockHistory', 'viewReports'],
  create: ['create', 'addInventory'],
  edit: ['edit', 'editInventory'],
  stockAdjust: ['stockAdjust', 'adjustStock'],
  export: ['export', 'exportInventory'],
};

function assertInventoryPermission(user: AuthUser, permission: string): void {
  if (user.accountType === 'Admin') return;
  const perms = user.inventoryPermissions;
  const keys = Object.keys(perms);
  if (keys.length === 0) return;
  const aliases = PERMISSION_ALIASES[permission] ?? [permission];
  const matchedKey = aliases.find((k) => k in perms);
  if (matchedKey && perms[matchedKey] === false) {
    throw new AppError(403, `Missing inventory permission: ${permission}`);
  }
}

inventoryRouter.get('/', async (req, res, next) => {
  try {
    assertInventoryPermission(req.user!, 'view');
    const query = inventoryQuerySchema.parse(req.query);
    const result = await inventoryService.listInventory(req.user!, query);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

inventoryRouter.post('/', async (req, res, next) => {
  try {
    assertInventoryPermission(req.user!, 'create');
    const input = createProductSchema.parse(req.body);
    const product = await inventoryService.createProduct(req.user!, input);
    res.status(201).json({ item: product });
  } catch (err) {
    next(err);
  }
});

inventoryRouter.get('/stock', async (req, res, next) => {
  try {
    assertInventoryPermission(req.user!, 'view');
    const productId = typeof req.query.productId === 'string' ? req.query.productId : undefined;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
    const result = await inventoryService.listStockTransactions(
      req.user!,
      productId,
      page,
      limit
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

inventoryRouter.post('/stock', async (req, res, next) => {
  try {
    assertInventoryPermission(req.user!, 'stockAdjust');
    const input = stockMovementSchema.parse(req.body);
    const result = await inventoryService.recordStockMovement(req.user!, input);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

inventoryRouter.get('/reports', async (req, res, next) => {
  try {
    assertInventoryPermission(req.user!, 'view');
    const report = await inventoryService.getReports(
      req.user!,
      req.query as Record<string, string | undefined>
    );
    res.json(report);
  } catch (err) {
    next(err);
  }
});

inventoryRouter.get('/export', async (req, res, next) => {
  try {
    assertInventoryPermission(req.user!, 'export');
    const format = typeof req.query.format === 'string' ? req.query.format.toLowerCase() : 'csv';
    if (!['csv', 'xls'].includes(format)) {
      throw new AppError(400, 'Supported export formats: csv, xls');
    }

    const content = await inventoryService.exportInventory(req.user!, format);
    const mime = format === 'xls' ? 'application/vnd.ms-excel' : 'text/csv';
    res.setHeader('Content-Type', `${mime}; charset=utf-8`);
    res.setHeader('Content-Disposition', `attachment; filename="inventory-export.${format}"`);
    res.send(content);
  } catch (err) {
    next(err);
  }
});

inventoryRouter.get('/:id', async (req, res, next) => {
  try {
    assertInventoryPermission(req.user!, 'view');
    const detail = await inventoryService.getProductById(req.user!, req.params.id);
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

inventoryRouter.put('/:id', async (req, res, next) => {
  try {
    assertInventoryPermission(req.user!, 'edit');
    const input = updateProductSchema.parse(req.body);
    const product = await inventoryService.updateProduct(req.user!, req.params.id, input);
    res.json({ item: product });
  } catch (err) {
    next(err);
  }
});

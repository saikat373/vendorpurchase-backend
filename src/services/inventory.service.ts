import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { AuthUser } from '../middleware/auth';
import {
  createProductSchema,
  inventoryQuerySchema,
  stockMovementSchema,
  updateProductSchema,
} from '../validators/inventory.validator';
import { z } from 'zod';

type CreateProductInput = z.infer<typeof createProductSchema>;
type UpdateProductInput = z.infer<typeof updateProductSchema>;
type StockMovementInput = z.infer<typeof stockMovementSchema>;
type InventoryQuery = z.infer<typeof inventoryQuerySchema>;

const CATEGORY_DISPLAY_NAMES: Record<string, string> = {
  Grocery: 'Kirana / Grocery',
  Pharmacy: 'Pharmacy / Medical',
  Mall: 'Supermarket / Mall',
};

function serializeBatch(b: {
  id: string;
  productId: string;
  batchNumber: string;
  manufacturingDate: Date | null;
  expiryDate: Date;
  quantity: Prisma.Decimal;
  purchasePrice: Prisma.Decimal;
  sellingPrice: Prisma.Decimal;
  mrp: Prisma.Decimal;
  location: string | null;
}) {
  return {
    ...b,
    quantity: Number(b.quantity),
    purchasePrice: Number(b.purchasePrice),
    sellingPrice: Number(b.sellingPrice),
    mrp: Number(b.mrp),
  };
}

function serializeProduct<
  T extends {
    purchasePrice: Prisma.Decimal;
    sellingPrice: Prisma.Decimal;
    mrp: Prisma.Decimal;
    gstPercent: Prisma.Decimal;
    stockQuantity: Prisma.Decimal;
    minimumStockLevel: Prisma.Decimal;
    maximumStockLevel: Prisma.Decimal;
    pharmacyBatches?: Array<Parameters<typeof serializeBatch>[0]>;
  },
>(p: T) {
  return {
    ...p,
    purchasePrice: Number(p.purchasePrice),
    sellingPrice: Number(p.sellingPrice),
    mrp: Number(p.mrp),
    gstPercent: Number(p.gstPercent),
    stockQuantity: Number(p.stockQuantity),
    minimumStockLevel: Number(p.minimumStockLevel),
    maximumStockLevel: Number(p.maximumStockLevel),
    ...(p.pharmacyBatches
      ? { pharmacyBatches: p.pharmacyBatches.map(serializeBatch) }
      : {}),
  };
}

function serializeTransaction<
  T extends {
    id: string;
    referenceNumber: string;
    productId: string;
    batchNumber: string | null;
    transactionType: string;
    quantity: Prisma.Decimal;
    previousQuantity: Prisma.Decimal;
    newQuantity: Prisma.Decimal;
    reason: string | null;
    createdAt: Date;
    product?: { id: string; sku: string; productName: string; inventoryCategory: string };
    performedByUser?: { id: string; name: string; email: string; role?: string };
  },
>(t: T) {
  const prev = Number(t.previousQuantity);
  const next = Number(t.newQuantity);
  return {
    id: t.id,
    referenceNumber: t.referenceNumber,
    productId: t.productId,
    sku: t.product?.sku ?? '',
    productName: t.product?.productName ?? '',
    inventoryCategory: t.product?.inventoryCategory ?? 'Grocery',
    batchNumber: t.batchNumber ?? undefined,
    previousQuantity: prev,
    quantity: Number(t.quantity),
    quantityDelta: Number((next - prev).toFixed(2)),
    newQuantity: next,
    transactionType: t.transactionType.startsWith('STOCK_')
      ? t.transactionType
      : `STOCK_${t.transactionType}`,
    reason: t.reason ?? '',
    performedBy: t.performedByUser
      ? {
          id: t.performedByUser.id,
          name: t.performedByUser.name,
          email: t.performedByUser.email,
          role: t.performedByUser.role,
        }
      : { id: '', name: 'System', email: '' },
    createdAt: t.createdAt,
  };
}

function serializeAuditLog(log: {
  id: string;
  entityType: string;
  entityId: string;
  operation: string;
  beforeSnapshot: Prisma.JsonValue | null;
  afterSnapshot: Prisma.JsonValue | null;
  createdAt: Date;
  performedByUser?: { id: string; name: string; email: string; role?: string };
}) {
  const before = (log.beforeSnapshot && typeof log.beforeSnapshot === 'object' && !Array.isArray(log.beforeSnapshot)
    ? log.beforeSnapshot
    : {}) as Record<string, unknown>;
  const after = (log.afterSnapshot && typeof log.afterSnapshot === 'object' && !Array.isArray(log.afterSnapshot)
    ? log.afterSnapshot
    : {}) as Record<string, unknown>;

  const changes: Array<{ field: string; before: string | number | boolean; after: string | number | boolean }> = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const field of keys) {
    if (field === 'updatedAt' || field === 'createdAt') continue;
    const bVal = before[field];
    const aVal = after[field];
    if (JSON.stringify(bVal) !== JSON.stringify(aVal)) {
      changes.push({
        field,
        before: typeof bVal === 'string' || typeof bVal === 'number' || typeof bVal === 'boolean' ? bVal : String(bVal ?? ''),
        after: typeof aVal === 'string' || typeof aVal === 'number' || typeof aVal === 'boolean' ? aVal : String(aVal ?? ''),
      });
    }
  }

  return {
    id: log.id,
    timestamp: log.createdAt,
    user: log.performedByUser
      ? {
          id: log.performedByUser.id,
          name: log.performedByUser.name,
          email: log.performedByUser.email,
          role: log.performedByUser.role,
        }
      : { id: '', name: 'System', email: '' },
    operation: log.operation,
    inventoryCategory: String(after.inventoryCategory ?? before.inventoryCategory ?? 'Grocery'),
    recordId: log.entityId,
    sku: String(after.sku ?? before.sku ?? ''),
    productName: String(after.productName ?? before.productName ?? ''),
    summary: `${log.operation} on ${log.entityType} (${log.entityId})`,
    changes,
  };
}

function assertVerticalAccess(user: AuthUser, vertical: string): void {
  if (user.accountType === 'Admin') return;
  if (user.allowedVerticals.length > 0 && !user.allowedVerticals.includes(vertical)) {
    throw new AppError(403, `Access denied for vertical: ${vertical}`);
  }
}

function assertLocationAccess(user: AuthUser, location: string): void {
  if (user.accountType === 'Admin') return;
  if (user.allowedLocations.length > 0 && !user.allowedLocations.includes(location)) {
    throw new AppError(403, `Access denied for store location: ${location}`);
  }
}

function buildScopeWhere(user: AuthUser, category?: string): Prisma.InventoryProductWhereInput {
  const where: Prisma.InventoryProductWhereInput = {};

  if (user.accountType !== 'Admin') {
    if (user.allowedVerticals.length === 0) {
      return { id: '__NO_ACCESS__' };
    }
    where.inventoryCategory = category
      ? user.allowedVerticals.includes(category)
        ? category
        : '__NO_ACCESS__'
      : { in: user.allowedVerticals };

    if (user.allowedLocations.length > 0) {
      where.storeLocation = { in: user.allowedLocations };
    }
  } else if (category) {
    where.inventoryCategory = category;
  }

  return where;
}

export async function listInventory(user: AuthUser, query: InventoryQuery) {
  const scopeWhere = buildScopeWhere(user, query.category);

  const where: Prisma.InventoryProductWhereInput = {
    ...scopeWhere,
    ...(query.search
      ? {
          OR: [
            { productName: { contains: query.search } },
            { sku: { contains: query.search } },
            { barcode: { contains: query.search } },
            { brand: { contains: query.search } },
          ],
        }
      : {}),
    ...(query.dateFrom || query.dateTo
      ? {
          createdAt: {
            ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
            ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
          },
        }
      : {}),
  };

  const allMatching = await prisma.inventoryProduct.findMany({
    where,
    include: { pharmacyBatches: true },
    orderBy: { [query.sortBy]: query.sortOrder },
  });

  const now = new Date();
  const soonCutoff = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const filtered = allMatching.filter((item) => {
    const qty = Number(item.stockQuantity);
    const min = Number(item.minimumStockLevel);

    if (query.stockStatus === 'OUT_OF_STOCK' && qty > 0) return false;
    if (query.stockStatus === 'LOW_STOCK' && (qty <= 0 || qty > min)) return false;
    if (query.stockStatus === 'IN_STOCK' && qty <= min) return false;

    if (query.expiryStatus) {
      const batches = item.pharmacyBatches;
      if (batches.length === 0) return false;
      const hasExpired = batches.some((b) => b.expiryDate < now);
      const hasExpiringSoon = batches.some(
        (b) => b.expiryDate >= now && b.expiryDate <= soonCutoff
      );
      if (query.expiryStatus === 'EXPIRED' && !hasExpired) return false;
      if (query.expiryStatus === 'EXPIRING_SOON' && !hasExpiringSoon) return false;
      if (query.expiryStatus === 'VALID' && (hasExpired || hasExpiringSoon)) return false;
    }

    return true;
  });

  const total = filtered.length;
  const start = (query.page - 1) * query.limit;
  const items = filtered.slice(start, start + query.limit).map(serializeProduct);

  const categories = Array.from(
    new Set(allMatching.map((i) => i.productCategory).filter((v): v is string => Boolean(v)))
  );
  const brands = Array.from(
    new Set(allMatching.map((i) => i.brand).filter((v): v is string => Boolean(v)))
  );
  const suppliers = Array.from(
    new Set(allMatching.map((i) => i.supplier).filter((v): v is string => Boolean(v)))
  );
  const locations = Array.from(new Set(allMatching.map((i) => i.storeLocation)));

  return {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      pageSize: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
    facets: {
      categories,
      brands,
      suppliers,
      locations,
    },
  };
}

export async function createProduct(user: AuthUser, input: CreateProductInput) {
  assertVerticalAccess(user, input.inventoryCategory);
  assertLocationAccess(user, input.storeLocation);

  const existingSku = await prisma.inventoryProduct.findUnique({ where: { sku: input.sku } });
  if (existingSku) {
    throw new AppError(409, `Product with SKU "${input.sku}" already exists`);
  }

  return prisma.$transaction(async (tx) => {
    const product = await tx.inventoryProduct.create({
      data: {
        sku: input.sku,
        barcode: input.barcode ?? null,
        inventoryCategory: input.inventoryCategory,
        productName: input.productName,
        brand: input.brand ?? null,
        productCategory: input.productCategory ?? null,
        supplier: input.supplier ?? null,
        purchasePrice: input.purchasePrice,
        sellingPrice: input.sellingPrice,
        mrp: input.mrp,
        gstPercent: input.gstPercent,
        unitOfMeasurement: input.unitOfMeasurement,
        stockQuantity: input.stockQuantity,
        minimumStockLevel: input.minimumStockLevel,
        maximumStockLevel: input.maximumStockLevel,
        status: input.status,
        storeLocation: input.storeLocation,
        categoryFields: input.categoryFields as Prisma.InputJsonValue,
      },
    });

    if (input.inventoryCategory === 'Pharmacy' && input.batch) {
      await tx.pharmacyBatch.create({
        data: {
          productId: product.id,
          batchNumber: input.batch.batchNumber,
          manufacturingDate: input.batch.manufacturingDate
            ? new Date(input.batch.manufacturingDate)
            : null,
          expiryDate: new Date(input.batch.expiryDate),
          quantity: input.stockQuantity,
          purchasePrice: input.purchasePrice,
          sellingPrice: input.sellingPrice,
          mrp: input.mrp,
          location: input.batch.location ?? input.storeLocation,
        },
      });
    }

    if (input.stockQuantity > 0) {
      await tx.stockTransaction.create({
        data: {
          referenceNumber: `INIT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          productId: product.id,
          batchNumber: input.batch?.batchNumber ?? null,
          transactionType: 'ADDITION',
          quantity: input.stockQuantity,
          previousQuantity: 0,
          newQuantity: input.stockQuantity,
          reason: 'Initial product creation',
          performedByUserId: user.id,
        },
      });
    }

    await tx.inventoryAuditLog.create({
      data: {
        entityType: 'PRODUCT',
        entityId: product.id,
        operation: 'CREATE',
        beforeSnapshot: Prisma.JsonNull,
        afterSnapshot: product as unknown as Prisma.InputJsonValue,
        performedByUserId: user.id,
      },
    });

    return product;
  });
}

export async function updateProduct(user: AuthUser, id: string, input: UpdateProductInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.inventoryProduct.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError(404, 'Product not found');
    }

    assertVerticalAccess(user, existing.inventoryCategory);
    assertLocationAccess(user, existing.storeLocation);
    if (input.inventoryCategory) assertVerticalAccess(user, input.inventoryCategory);
    if (input.storeLocation) assertLocationAccess(user, input.storeLocation);

    const updated = await tx.inventoryProduct.update({
      where: { id },
      data: {
        ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
        ...(input.inventoryCategory !== undefined
          ? { inventoryCategory: input.inventoryCategory }
          : {}),
        ...(input.productName !== undefined ? { productName: input.productName } : {}),
        ...(input.brand !== undefined ? { brand: input.brand } : {}),
        ...(input.productCategory !== undefined
          ? { productCategory: input.productCategory }
          : {}),
        ...(input.supplier !== undefined ? { supplier: input.supplier } : {}),
        ...(input.purchasePrice !== undefined ? { purchasePrice: input.purchasePrice } : {}),
        ...(input.sellingPrice !== undefined ? { sellingPrice: input.sellingPrice } : {}),
        ...(input.mrp !== undefined ? { mrp: input.mrp } : {}),
        ...(input.gstPercent !== undefined ? { gstPercent: input.gstPercent } : {}),
        ...(input.unitOfMeasurement !== undefined
          ? { unitOfMeasurement: input.unitOfMeasurement }
          : {}),
        ...(input.minimumStockLevel !== undefined
          ? { minimumStockLevel: input.minimumStockLevel }
          : {}),
        ...(input.maximumStockLevel !== undefined
          ? { maximumStockLevel: input.maximumStockLevel }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.storeLocation !== undefined ? { storeLocation: input.storeLocation } : {}),
        ...(input.categoryFields !== undefined
          ? { categoryFields: input.categoryFields as Prisma.InputJsonValue }
          : {}),
      },
    });

    await tx.inventoryAuditLog.create({
      data: {
        entityType: 'PRODUCT',
        entityId: id,
        operation: 'UPDATE',
        beforeSnapshot: existing as unknown as Prisma.InputJsonValue,
        afterSnapshot: updated as unknown as Prisma.InputJsonValue,
        performedByUserId: user.id,
      },
    });

    return updated;
  });
}

export async function listStockTransactions(
  user: AuthUser,
  productId?: string,
  page = 1,
  limit = 20
) {
  const scopeWhere = buildScopeWhere(user);

  const where: Prisma.StockTransactionWhereInput = {
    ...(productId ? { productId } : {}),
    product: scopeWhere,
  };

  const [items, total] = await Promise.all([
    prisma.stockTransaction.findMany({
      where,
      include: {
        product: { select: { id: true, sku: true, productName: true, inventoryCategory: true } },
        performedByUser: { select: { id: true, name: true, email: true, accountType: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.stockTransaction.count({ where }),
  ]);

  return {
    items: items.map(serializeTransaction),
    pagination: { page, limit, pageSize: limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getProductById(user: AuthUser, id: string) {
  const product = await prisma.inventoryProduct.findUnique({
    where: { id },
    include: { pharmacyBatches: true },
  });
  if (!product) {
    throw new AppError(404, 'Product not found');
  }
  assertVerticalAccess(user, product.inventoryCategory);
  assertLocationAccess(user, product.storeLocation);

  const [transactions, auditLogs] = await Promise.all([
    prisma.stockTransaction.findMany({
      where: { productId: id },
      include: {
        product: { select: { id: true, sku: true, productName: true, inventoryCategory: true } },
        performedByUser: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    prisma.inventoryAuditLog.findMany({
      where: { entityType: 'PRODUCT', entityId: id },
      include: {
        performedByUser: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
  ]);

  return {
    product: serializeProduct(product),
    transactions: transactions.map(serializeTransaction),
    auditLogs: auditLogs.map(serializeAuditLog),
  };
}

export async function recordStockMovement(user: AuthUser, input: StockMovementInput) {
  return prisma.$transaction(async (tx) => {
    if (env.dbClient === 'mysql2') {
      await tx.$executeRaw`SELECT id FROM inventory_products WHERE id = ${input.productId} FOR UPDATE`;
    }

    const product = await tx.inventoryProduct.findUnique({ where: { id: input.productId } });
    if (!product) {
      throw new AppError(404, 'Product not found');
    }

    assertVerticalAccess(user, product.inventoryCategory);
    assertLocationAccess(user, product.storeLocation);

    const previousQuantity = Number(product.stockQuantity);
    let newQuantity = previousQuantity;

    if (input.transactionType === 'ADDITION') {
      newQuantity = previousQuantity + input.quantity;
    } else if (input.transactionType === 'REDUCTION' || input.transactionType === 'TRANSFER') {
      newQuantity = previousQuantity - input.quantity;
    } else if (input.transactionType === 'ADJUSTMENT') {
      newQuantity = input.quantity;
    }

    if (newQuantity < 0) {
      throw new AppError(
        400,
        `Insufficient stock: current ${previousQuantity}, requested change ${input.quantity}`
      );
    }

    if (product.inventoryCategory === 'Pharmacy' && input.batchNumber) {
      const existingBatch = await tx.pharmacyBatch.findFirst({
        where: { productId: product.id, batchNumber: input.batchNumber },
      });

      if (existingBatch) {
        const batchPrev = Number(existingBatch.quantity);
        let batchNext = batchPrev;
        if (input.transactionType === 'ADDITION') batchNext = batchPrev + input.quantity;
        else if (input.transactionType === 'REDUCTION' || input.transactionType === 'TRANSFER') {
          batchNext = batchPrev - input.quantity;
        } else if (input.transactionType === 'ADJUSTMENT') {
          batchNext = input.quantity;
        }

        if (batchNext < 0) {
          throw new AppError(400, `Insufficient stock in batch ${input.batchNumber}`);
        }

        await tx.pharmacyBatch.update({
          where: { id: existingBatch.id },
          data: { quantity: batchNext },
        });
      } else if (input.transactionType === 'ADDITION' && input.expiryDate) {
        await tx.pharmacyBatch.create({
          data: {
            productId: product.id,
            batchNumber: input.batchNumber,
            manufacturingDate: input.manufacturingDate
              ? new Date(input.manufacturingDate)
              : null,
            expiryDate: new Date(input.expiryDate),
            quantity: input.quantity,
            purchasePrice: product.purchasePrice,
            sellingPrice: product.sellingPrice,
            mrp: product.mrp,
            location: product.storeLocation,
          },
        });
      }
    }

    const updatedProduct = await tx.inventoryProduct.update({
      where: { id: product.id },
      data: { stockQuantity: newQuantity },
    });

    const transaction = await tx.stockTransaction.create({
      data: {
        referenceNumber:
          input.referenceNumber ?? `STK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        productId: product.id,
        batchNumber: input.batchNumber ?? null,
        transactionType: input.transactionType,
        quantity: input.quantity,
        previousQuantity,
        newQuantity,
        reason: input.reason ?? null,
        performedByUserId: user.id,
      },
    });

    await tx.inventoryAuditLog.create({
      data: {
        entityType: 'PRODUCT',
        entityId: product.id,
        operation: `STOCK_${input.transactionType}`,
        beforeSnapshot: { stockQuantity: previousQuantity },
        afterSnapshot: { stockQuantity: newQuantity, transactionId: transaction.id },
        performedByUserId: user.id,
      },
    });

    return { product: updatedProduct, transaction };
  });
}

export async function getReports(
  user: AuthUser,
  query?: {
    mode?: string;
    category?: string;
    operation?: string;
    search?: string;
    page?: string;
    pageSize?: string;
  }
) {
  if (query?.mode === 'audit') {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20)));
    const where: Prisma.InventoryAuditLogWhereInput = {
      ...(query.operation && query.operation !== 'ALL' ? { operation: query.operation } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.inventoryAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          performedByUser: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.inventoryAuditLog.count({ where }),
    ]);

    return {
      items: items.map(serializeAuditLog),
      pagination: {
        page,
        limit: pageSize,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  const categoryFilter =
    query?.category && query.category !== 'ALL' ? query.category : undefined;
  const scopeWhere = buildScopeWhere(user, categoryFilter);
  const products = await prisma.inventoryProduct.findMany({
    where: scopeWhere,
    include: { pharmacyBatches: true },
  });

  const now = new Date();
  const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  let totalActiveProducts = 0;
  let totalInactiveProducts = 0;
  let totalStockQuantity = 0;
  let totalPurchaseValue = 0;
  let totalRetailValue = 0;

  const categoryMap = new Map<
    string,
    {
      category: string;
      displayName: string;
      totalProducts: number;
      activeProducts: number;
      totalStockQuantity: number;
      purchaseValue: number;
      retailValue: number;
      lowStockCount: number;
      outOfStockCount: number;
      expiringCount: number;
    }
  >();

  const lowStockProducts: ReturnType<typeof serializeProduct>[] = [];
  const outOfStockProducts: ReturnType<typeof serializeProduct>[] = [];
  const expiringProducts: ReturnType<typeof serializeProduct>[] = [];
  const pharmacyBatchAlerts: Array<{
    productId: string;
    sku: string;
    medicineName: string;
    schedule: string;
    batch: ReturnType<typeof serializeBatch>;
    expiryStatus: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';
    daysRemaining: number;
  }> = [];

  for (const p of products) {
    const serialized = serializeProduct(p);
    const qty = serialized.stockQuantity;
    const min = serialized.minimumStockLevel;
    const pVal = qty * serialized.purchasePrice;
    const rVal = qty * serialized.sellingPrice;
    const isActive = p.status === 'ACTIVE';

    if (isActive) totalActiveProducts += 1;
    else totalInactiveProducts += 1;

    totalStockQuantity += qty;
    totalPurchaseValue += pVal;
    totalRetailValue += rVal;

    if (!categoryMap.has(p.inventoryCategory)) {
      categoryMap.set(p.inventoryCategory, {
        category: p.inventoryCategory,
        displayName: CATEGORY_DISPLAY_NAMES[p.inventoryCategory] ?? p.inventoryCategory,
        totalProducts: 0,
        activeProducts: 0,
        totalStockQuantity: 0,
        purchaseValue: 0,
        retailValue: 0,
        lowStockCount: 0,
        outOfStockCount: 0,
        expiringCount: 0,
      });
    }
    const catStats = categoryMap.get(p.inventoryCategory)!;
    catStats.totalProducts += 1;
    if (isActive) catStats.activeProducts += 1;
    catStats.totalStockQuantity += qty;
    catStats.purchaseValue += pVal;
    catStats.retailValue += rVal;

    if (qty <= 0) {
      outOfStockProducts.push(serialized);
      catStats.outOfStockCount += 1;
    } else if (qty <= min) {
      lowStockProducts.push(serialized);
      catStats.lowStockCount += 1;
    }

    let productHasExpiring = false;
    for (const batch of p.pharmacyBatches) {
      const daysRemaining = Math.ceil(
        (batch.expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (batch.expiryDate < now || batch.expiryDate <= thirtyDaysOut) {
        productHasExpiring = true;
        const fields = (p.categoryFields ?? {}) as Record<string, unknown>;
        pharmacyBatchAlerts.push({
          productId: p.id,
          sku: p.sku,
          medicineName: p.productName,
          schedule: typeof fields.schedule === 'string' ? fields.schedule : 'OTC',
          batch: serializeBatch(batch),
          expiryStatus: batch.expiryDate < now ? 'EXPIRED' : 'EXPIRING_SOON',
          daysRemaining,
        });
      }
    }

    if (productHasExpiring) {
      expiringProducts.push(serialized);
      catStats.expiringCount += 1;
    }
  }

  const [recentTransactions, auditLogs] = await Promise.all([
    prisma.stockTransaction.findMany({
      where: { product: scopeWhere },
      orderBy: { createdAt: 'desc' },
      take: 15,
      include: {
        product: { select: { id: true, sku: true, productName: true, inventoryCategory: true } },
        performedByUser: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.inventoryAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: {
        performedByUser: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  return {
    metrics: {
      totalProducts: products.length,
      totalActiveProducts,
      totalInactiveProducts,
      totalInventoryCategories: categoryMap.size,
      totalStockQuantity: Number(totalStockQuantity.toFixed(2)),
      lowStockCount: lowStockProducts.length,
      outOfStockCount: outOfStockProducts.length,
      expiringCount: expiringProducts.length,
      totalPurchaseValue: Number(totalPurchaseValue.toFixed(2)),
      totalRetailValue: Number(totalRetailValue.toFixed(2)),
    },
    categorySummary: Array.from(categoryMap.values()).map((c) => ({
      ...c,
      totalStockQuantity: Number(c.totalStockQuantity.toFixed(2)),
      purchaseValue: Number(c.purchaseValue.toFixed(2)),
      retailValue: Number(c.retailValue.toFixed(2)),
    })),
    lowStockProducts,
    outOfStockProducts,
    expiringProducts,
    pharmacyBatchAlerts,
    recentTransactions: recentTransactions.map(serializeTransaction),
    auditLogs: auditLogs.map(serializeAuditLog),
  };
}

export async function exportInventory(user: AuthUser, format: string) {
  const scopeWhere = buildScopeWhere(user);
  const products = await prisma.inventoryProduct.findMany({
    where: scopeWhere,
    orderBy: { productName: 'asc' },
  });

  const headers = [
    'SKU',
    'Product Name',
    'Category',
    'Brand',
    'Store Location',
    'Stock Quantity',
    'Unit',
    'Purchase Price',
    'Selling Price',
    'MRP',
    'Status',
  ];

  const delimiter = format === 'xls' ? '\t' : ',';
  const escapeCell = (val: unknown) => {
    const str = String(val ?? '');
    if (format === 'csv' && (str.includes(',') || str.includes('"') || str.includes('\n'))) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = products.map((p) =>
    [
      p.sku,
      p.productName,
      p.inventoryCategory,
      p.brand ?? '',
      p.storeLocation,
      p.stockQuantity.toString(),
      p.unitOfMeasurement,
      p.purchasePrice.toString(),
      p.sellingPrice.toString(),
      p.mrp.toString(),
      p.status,
    ]
      .map(escapeCell)
      .join(delimiter)
  );

  return [headers.join(delimiter), ...rows].join('\n');
}

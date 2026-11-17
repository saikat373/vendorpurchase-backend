import { z } from 'zod';

export const verticalEnum = z.enum(['Grocery', 'Pharmacy', 'Mall']);
export const transactionTypeEnum = z.preprocess(
  (val) => {
    if (typeof val === 'string') {
      if (val === 'STOCK_CORRECTION') return 'ADJUSTMENT';
      if (val.startsWith('STOCK_')) return val.slice('STOCK_'.length);
    }
    return val;
  },
  z.enum(['ADDITION', 'REDUCTION', 'ADJUSTMENT', 'TRANSFER'])
);

export const createProductSchema = z.object({
  sku: z.string().min(1),
  barcode: z.string().optional(),
  inventoryCategory: verticalEnum,
  productName: z.string().min(1),
  brand: z.string().optional(),
  productCategory: z.string().optional(),
  supplier: z.string().optional(),
  purchasePrice: z.coerce.number().nonnegative(),
  sellingPrice: z.coerce.number().nonnegative(),
  mrp: z.coerce.number().nonnegative(),
  gstPercent: z.coerce.number().min(0).max(100).default(0),
  unitOfMeasurement: z.string().default('pcs'),
  stockQuantity: z.coerce.number().nonnegative().default(0),
  minimumStockLevel: z.coerce.number().nonnegative().default(0),
  maximumStockLevel: z.coerce.number().nonnegative().default(0),
  status: z.string().default('ACTIVE'),
  storeLocation: z.string().min(1),
  categoryFields: z.record(z.unknown()).default({}),
  batch: z
    .object({
      batchNumber: z.string().min(1),
      manufacturingDate: z.string().datetime().optional(),
      expiryDate: z.string().datetime(),
      location: z.string().optional(),
    })
    .optional(),
});

export const updateProductSchema = createProductSchema.partial().omit({ sku: true, batch: true });

export const stockMovementSchema = z.object({
  productId: z.string().uuid(),
  batchNumber: z.string().optional(),
  transactionType: transactionTypeEnum,
  quantity: z.coerce.number().positive(),
  reason: z.string().optional(),
  referenceNumber: z.string().optional(),
  expiryDate: z.string().datetime().optional(),
  manufacturingDate: z.string().datetime().optional(),
});

const optionalAllToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((val) => (val === 'ALL' || val === '' ? undefined : val), schema.optional());

export const inventoryQuerySchema = z
  .object({
    category: optionalAllToUndefined(verticalEnum),
    search: z.string().optional(),
    stockStatus: optionalAllToUndefined(z.enum(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'])),
    expiryStatus: optionalAllToUndefined(z.enum(['EXPIRED', 'EXPIRING_SOON', 'VALID'])),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    sortBy: z
      .enum(['productName', 'stockQuantity', 'sellingPrice', 'createdAt', 'updatedAt'])
      .default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(500).optional(),
    pageSize: z.coerce.number().int().positive().max(500).optional(),
  })
  .transform((val) => ({
    ...val,
    limit: val.limit ?? val.pageSize ?? 20,
  }));

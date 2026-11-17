export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'VendorPurchase Backend API',
    version: '1.0.0',
    description:
      'Node.js + TypeScript + Prisma REST API for Admin/Vendor RBAC, Kirana (Grocery) / Pharmacy / Mall Inventory, Atomic Stock Transactions, Audit Logs, and Reports (SQLite testing -> MySQL production).',
  },
  servers: [
    {
      url: 'http://localhost:4000',
      description: 'Local Development Server',
    },
  ],
  tags: [
    { name: 'Health', description: 'Server health check' },
    { name: 'Auth', description: 'Authentication and current user session' },
    { name: 'Admin Vendors', description: 'Admin-only vendor management & RBAC' },
    { name: 'Inventory', description: 'Products, atomic stock ledger, reports, and exports' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Paste the JWT returned from POST /api/auth/login',
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Validation failed' },
          details: { type: 'object', nullable: true },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          accountType: { type: 'string', enum: ['Admin', 'Vendor'] },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          company: { type: 'string', nullable: true },
          role: { type: 'string' },
          isActive: { type: 'boolean' },
          approved: { type: 'boolean' },
          allowedVerticals: {
            type: 'array',
            items: { type: 'string', enum: ['Grocery', 'Pharmacy', 'Mall'] },
          },
          allowedLocations: { type: 'array', items: { type: 'string' } },
          userPermissions: { type: 'object', additionalProperties: { type: 'boolean' } },
          inventoryPermissions: { type: 'object', additionalProperties: { type: 'boolean' } },
          menuPermissions: { type: 'object', additionalProperties: { type: 'boolean' } },
          modulePermissions: { type: 'object', additionalProperties: { type: 'boolean' } },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', example: 'admin@vendorpurchase.local' },
          password: { type: 'string', example: 'Admin@123' },
          accountType: { type: 'string', enum: ['Admin', 'Vendor'], example: 'Admin' },
        },
      },
      CreateVendorRequest: {
        type: 'object',
        required: ['name', 'email', 'password'],
        properties: {
          name: { type: 'string', example: 'Metro Mart Vendor' },
          email: { type: 'string', format: 'email', example: 'metro@vendorpurchase.local' },
          password: { type: 'string', minLength: 6, example: 'Vendor@123' },
          company: { type: 'string', example: 'Metro Retail Pvt Ltd' },
          role: { type: 'string', default: 'Vendor' },
          isActive: { type: 'boolean', default: true },
          approved: { type: 'boolean', default: true },
          allowedVerticals: {
            type: 'array',
            items: { type: 'string', enum: ['Grocery', 'Pharmacy', 'Mall'] },
            example: ['Grocery', 'Mall'],
          },
          allowedLocations: {
            type: 'array',
            items: { type: 'string' },
            example: ['Main Store'],
          },
          inventoryPermissions: {
            type: 'object',
            additionalProperties: { type: 'boolean' },
            example: { view: true, create: true, edit: false, stockAdjust: true, export: false },
          },
        },
      },
      CreateProductRequest: {
        type: 'object',
        required: [
          'sku',
          'inventoryCategory',
          'productName',
          'purchasePrice',
          'sellingPrice',
          'mrp',
          'storeLocation',
        ],
        properties: {
          sku: { type: 'string', example: 'GRO-DAL-002' },
          barcode: { type: 'string', example: '8901001000099' },
          inventoryCategory: { type: 'string', enum: ['Grocery', 'Pharmacy', 'Mall'] },
          productName: { type: 'string', example: 'Toor Dal 1kg' },
          brand: { type: 'string', example: 'Tata Sampann' },
          productCategory: { type: 'string', example: 'Pulses' },
          supplier: { type: 'string', example: 'Agro Foods Ltd' },
          purchasePrice: { type: 'number', example: 125.5 },
          sellingPrice: { type: 'number', example: 155.0 },
          mrp: { type: 'number', example: 170.0 },
          gstPercent: { type: 'number', default: 0, example: 5 },
          unitOfMeasurement: { type: 'string', default: 'pcs', example: 'kg' },
          stockQuantity: { type: 'number', default: 0, example: 50 },
          minimumStockLevel: { type: 'number', default: 0, example: 10 },
          maximumStockLevel: { type: 'number', default: 0, example: 200 },
          status: { type: 'string', default: 'ACTIVE' },
          storeLocation: { type: 'string', example: 'Main Store' },
          categoryFields: { type: 'object', additionalProperties: true, example: { looseItem: false } },
          batch: {
            type: 'object',
            description: 'Optional batch metadata for Pharmacy products',
            properties: {
              batchNumber: { type: 'string', example: 'BATCH-2026-B1' },
              manufacturingDate: { type: 'string', format: 'date-time' },
              expiryDate: { type: 'string', format: 'date-time', example: '2027-12-31T00:00:00Z' },
              location: { type: 'string', example: 'Main Store' },
            },
          },
        },
      },
      StockMovementRequest: {
        type: 'object',
        required: ['productId', 'transactionType', 'quantity'],
        properties: {
          productId: { type: 'string', format: 'uuid' },
          batchNumber: { type: 'string', example: 'BATCH-2026-A1' },
          transactionType: {
            type: 'string',
            enum: ['ADDITION', 'REDUCTION', 'ADJUSTMENT', 'TRANSFER'],
          },
          quantity: { type: 'number', minimum: 0.01, example: 10 },
          reason: { type: 'string', example: 'Supplier restock' },
          referenceNumber: { type: 'string', example: 'PO-2026-1001' },
          expiryDate: { type: 'string', format: 'date-time' },
          manufacturingDate: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        responses: {
          '200': {
            description: 'Server is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    dbClient: { type: 'string', example: 'sqlite3' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Authenticate Admin or Vendor and issue JWT',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } },
          },
        },
        responses: {
          '200': { description: 'Authenticated successfully, returns { token, user }' },
          '401': { description: 'Invalid credentials or mismatched accountType' },
          '403': { description: 'Account is inactive (isActive === false)' },
        },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Get current user & live permissions from DB',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Returns live { user }' },
          '401': { description: 'Missing or invalid token' },
          '403': { description: 'Account deactivated' },
        },
      },
    },
    '/api/admin/vendors': {
      get: {
        tags: ['Admin Vendors'],
        summary: 'List vendors/users with search & pagination (Admin only)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'accountType', in: 'query', schema: { type: 'string', enum: ['Admin', 'Vendor'] } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          '200': { description: 'Paginated list of users/vendors' },
          '403': { description: 'Admin access required' },
        },
      },
      post: {
        tags: ['Admin Vendors'],
        summary: 'Create a new Vendor account (Admin only)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreateVendorRequest' } },
          },
        },
        responses: {
          '201': { description: 'Vendor created' },
          '409': { description: 'Email already exists' },
        },
      },
    },
    '/api/admin/vendors/{id}/status': {
      patch: {
        tags: ['Admin Vendors'],
        summary: 'Activate or deactivate a Vendor (Admin only)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['isActive'],
                properties: { isActive: { type: 'boolean' } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Vendor status updated' },
          '404': { description: 'Vendor not found' },
        },
      },
    },
    '/api/admin/vendors/{id}/permissions': {
      patch: {
        tags: ['Admin Vendors'],
        summary: 'Update Vendor verticals, locations, and permission maps (Admin only)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  allowedVerticals: {
                    type: 'array',
                    items: { type: 'string', enum: ['Grocery', 'Pharmacy', 'Mall'] },
                  },
                  allowedLocations: { type: 'array', items: { type: 'string' } },
                  userPermissions: { type: 'object', additionalProperties: { type: 'boolean' } },
                  inventoryPermissions: { type: 'object', additionalProperties: { type: 'boolean' } },
                  menuPermissions: { type: 'object', additionalProperties: { type: 'boolean' } },
                  modulePermissions: { type: 'object', additionalProperties: { type: 'boolean' } },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Permissions updated' },
          '404': { description: 'Vendor not found' },
        },
      },
    },
    '/api/inventory': {
      get: {
        tags: ['Inventory'],
        summary: 'Filter, sort, and paginate inventory products (scoped by RBAC)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'category', in: 'query', schema: { type: 'string', enum: ['Grocery', 'Pharmacy', 'Mall'] } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'stockStatus', in: 'query', schema: { type: 'string', enum: ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'] } },
          { name: 'expiryStatus', in: 'query', schema: { type: 'string', enum: ['EXPIRED', 'EXPIRING_SOON', 'VALID'] } },
          { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'sortBy', in: 'query', schema: { type: 'string', enum: ['productName', 'stockQuantity', 'sellingPrice', 'createdAt', 'updatedAt'], default: 'createdAt' } },
          { name: 'sortOrder', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          '200': { description: 'Returns { items, pagination, facets }' },
        },
      },
      post: {
        tags: ['Inventory'],
        summary: 'Create product + optional pharmacy batch + initial stock transaction + audit log',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreateProductRequest' } },
          },
        },
        responses: {
          '201': { description: 'Product created' },
          '409': { description: 'Duplicate SKU' },
        },
      },
    },
    '/api/inventory/{id}': {
      put: {
        tags: ['Inventory'],
        summary: 'Update product & record before/after snapshot in audit log',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreateProductRequest' } },
          },
        },
        responses: {
          '200': { description: 'Product updated' },
          '404': { description: 'Product not found' },
        },
      },
    },
    '/api/inventory/stock': {
      get: {
        tags: ['Inventory'],
        summary: 'List immutable stock transaction ledger',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'productId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          '200': { description: 'Paginated stock transactions' },
        },
      },
      post: {
        tags: ['Inventory'],
        summary: 'Execute atomic stock movement (ADDITION | REDUCTION | ADJUSTMENT | TRANSFER)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/StockMovementRequest' } },
          },
        },
        responses: {
          '201': { description: 'Returns { product, transaction }' },
          '400': { description: 'Insufficient stock or validation error' },
          '404': { description: 'Product not found' },
        },
      },
    },
    '/api/inventory/reports': {
      get: {
        tags: ['Inventory'],
        summary: 'Dashboard KPIs, category valuation, low stock, pharmacy expiry & audit logs',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Aggregated inventory report' },
        },
      },
    },
    '/api/inventory/export': {
      get: {
        tags: ['Inventory'],
        summary: 'Download inventory export as CSV or XLS',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'format',
            in: 'query',
            schema: { type: 'string', enum: ['csv', 'xls'], default: 'csv' },
          },
        ],
        responses: {
          '200': { description: 'File stream attachment' },
          '400': { description: 'Unsupported format' },
        },
      },
    },
  },
} as const;

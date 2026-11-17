# VendorPurchase Backend — API Documentation

- **Base URL:** `http://localhost:4000`
- **Interactive Swagger UI:** `http://localhost:4000/api-docs`
- **OpenAPI 3.0 JSON Spec:** `http://localhost:4000/api-docs.json`

---

## 1. Authentication & RBAC Rules

All protected endpoints require a Bearer JWT in the `Authorization` header:

```http
Authorization: Bearer <token>
```

1. **Live User Check:** Every protected request queries the `users` table for the authenticated user. If `isActive === false`, the API immediately returns `403 Forbidden` even if the JWT has not expired.
2. **Vertical & Location Scoping:**
   - `Admin` users can access all verticals (`Grocery`, `Pharmacy`, `Mall`) and all store locations.
   - `Vendor` users are automatically scoped to their `allowedVerticals` and `allowedLocations` (when non-empty).
3. **Inventory Permission Flags (`inventoryPermissions`):**
   - `view` (`GET /api/inventory`, `GET /api/inventory/stock`, `GET /api/inventory/reports`)
   - `create` (`POST /api/inventory`)
   - `edit` (`PUT /api/inventory/:id`)
   - `stockAdjust` (`POST /api/inventory/stock`)
   - `export` (`GET /api/inventory/export`)

### Seeded Test Accounts
| Role | Email | Password | `accountType` |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin@vendorpurchase.local` | `Admin@123` | `Admin` |
| **Vendor** | `vendor@vendorpurchase.local` | `Vendor@123` | `Vendor` |

---

## 2. Standard Error Format

```json
{
  "error": "Human-readable error message",
  "details": {}
}
```

Common status codes: `400` (Validation / Insufficient Stock), `401` (Invalid/Missing Token or Credentials), `403` (Inactive Account / Missing Permission / Admin Required), `404` (Not Found), `409` (Duplicate Email or SKU).

---

## 3. Endpoints

### Health
#### `GET /health`
Returns server status and active database client.
- **Response `200`:**
  ```json
  { "status": "ok", "dbClient": "sqlite3" }
  ```

---

### Auth

#### `POST /api/auth/login`
Authenticates an `Admin` or `Vendor` and returns a signed JWT.
- **Request Body:**
  ```json
  {
    "email": "admin@vendorpurchase.local",
    "password": "Admin@123",
    "accountType": "Admin"
  }
  ```
- **Response `200`:**
  ```json
  {
    "token": "<jwt-token>",
    "user": {
      "id": "uuid",
      "accountType": "Admin",
      "name": "System Admin",
      "email": "admin@vendorpurchase.local",
      "isActive": true,
      "allowedVerticals": ["Grocery", "Pharmacy", "Mall"],
      "allowedLocations": ["Main Store", "Warehouse A"],
      "inventoryPermissions": { "view": true, "create": true, "edit": true, "stockAdjust": true, "export": true }
    }
  }
  ```

#### `GET /api/auth/me`
- **Auth:** Bearer JWT
- **Response `200`:** `{ "user": { ... } }` (live record from DB).

---

### Admin Vendor Management *(Admin Only)*

#### `GET /api/admin/vendors`
- **Auth:** Bearer JWT (`Admin`)
- **Query Params:** `search`, `accountType` (`Admin` | `Vendor`), `page` (default `1`), `limit` (default `20`, max `100`).
- **Response `200`:**
  ```json
  {
    "items": [ { "id": "uuid", "name": "...", "email": "...", "isActive": true } ],
    "pagination": { "page": 1, "limit": 20, "total": 2, "totalPages": 1 }
  }
  ```

#### `POST /api/admin/vendors`
Creates a new Vendor user with hashed password and RBAC configuration.
- **Auth:** Bearer JWT (`Admin`)
- **Request Body:**
  ```json
  {
    "name": "Metro Mart Vendor",
    "email": "metro@vendorpurchase.local",
    "password": "Vendor@123",
    "company": "Metro Retail Pvt Ltd",
    "allowedVerticals": ["Grocery", "Mall"],
    "allowedLocations": ["Main Store"],
    "inventoryPermissions": {
      "view": true,
      "create": true,
      "edit": false,
      "stockAdjust": true,
      "export": false
    }
  }
  ```
- **Response `201`:** `{ "vendor": { ... } }`

#### `PATCH /api/admin/vendors/:id/status`
Activates or deactivates a Vendor immediately.
- **Auth:** Bearer JWT (`Admin`)
- **Request Body:** `{ "isActive": false }`
- **Response `200`:** `{ "vendor": { ... } }`

#### `PATCH /api/admin/vendors/:id/permissions`
Updates a Vendor's `allowedVerticals`, `allowedLocations`, `userPermissions`, `inventoryPermissions`, `menuPermissions`, or `modulePermissions`.
- **Auth:** Bearer JWT (`Admin`)
- **Request Body:**
  ```json
  {
    "allowedVerticals": ["Grocery"],
    "inventoryPermissions": { "view": true, "create": true, "edit": true, "stockAdjust": true, "export": true }
  }
  ```
- **Response `200`:** `{ "vendor": { ... } }`

---

### Inventory, Stock & Reports

#### `GET /api/inventory`
Lists inventory products scoped by the caller's verticals and locations.
- **Auth:** Bearer JWT (`inventoryPermissions.view`)
- **Query Params:**
  - `category`: `Grocery` | `Pharmacy` | `Mall`
  - `search`: Matches `productName`, `sku`, `barcode`, `brand`
  - `stockStatus`: `IN_STOCK` | `LOW_STOCK` | `OUT_OF_STOCK`
  - `expiryStatus`: `EXPIRED` | `EXPIRING_SOON` | `VALID`
  - `dateFrom`, `dateTo`: ISO date strings
  - `sortBy`: `productName` | `stockQuantity` | `sellingPrice` | `createdAt` | `updatedAt`
  - `sortOrder`: `asc` | `desc`
  - `page`, `limit`
- **Response `200`:**
  ```json
  {
    "items": [ ... ],
    "pagination": { "page": 1, "limit": 20, "total": 3, "totalPages": 1 },
    "facets": { "categories": ["Grocery", "Pharmacy", "Mall"], "locations": ["Main Store", "Warehouse A"] }
  }
  ```

#### `POST /api/inventory`
Creates a product, optional `pharmacy_batches` record, initial `ADDITION` in `stock_transactions` (if `stockQuantity > 0`), and `CREATE` entry in `inventory_audit_logs`.
- **Auth:** Bearer JWT (`inventoryPermissions.create`)
- **Request Body:**
  ```json
  {
    "sku": "GRO-DAL-002",
    "barcode": "8901001000099",
    "inventoryCategory": "Grocery",
    "productName": "Toor Dal 1kg",
    "brand": "Tata Sampann",
    "purchasePrice": 125.5,
    "sellingPrice": 155,
    "mrp": 170,
    "gstPercent": 5,
    "unitOfMeasurement": "kg",
    "stockQuantity": 50,
    "minimumStockLevel": 10,
    "maximumStockLevel": 200,
    "storeLocation": "Main Store",
    "categoryFields": { "looseItem": false }
  }
  ```
- **Response `201`:** `{ "item": { ... } }`

#### `PUT /api/inventory/:id`
Updates product fields (excluding `sku`) and writes a `beforeSnapshot` / `afterSnapshot` diff to `inventory_audit_logs`.
- **Auth:** Bearer JWT (`inventoryPermissions.edit`)
- **Response `200`:** `{ "item": { ... } }`

#### `GET /api/inventory/stock`
Lists immutable stock transactions scoped by RBAC.
- **Auth:** Bearer JWT (`inventoryPermissions.view`)
- **Query Params:** `productId`, `page`, `limit`
- **Response `200`:** `{ "items": [ ... ], "pagination": { ... } }`

#### `POST /api/inventory/stock`
Executes an atomic stock movement inside a DB transaction (with `SELECT ... FOR UPDATE` row locking on MySQL).
- **Auth:** Bearer JWT (`inventoryPermissions.stockAdjust`)
- **Request Body:**
  ```json
  {
    "productId": "uuid-of-product",
    "batchNumber": "BATCH-2026-A1",
    "transactionType": "ADDITION",
    "quantity": 10,
    "reason": "Supplier restock",
    "referenceNumber": "PO-2026-1001"
  }
  ```
  `transactionType` values: `ADDITION` | `REDUCTION` | `ADJUSTMENT` | `TRANSFER`.
- **Response `201`:** `{ "product": { ... }, "transaction": { ... } }`

#### `GET /api/inventory/reports`
Returns dashboard KPIs, category valuation, low-stock items, pharmacy expiry alerts (expired & expiring within 30 days), and recent audit logs.
- **Auth:** Bearer JWT (`inventoryPermissions.view`)
- **Response `200`:**
  ```json
  {
    "kpis": {
      "totalProducts": 3,
      "totalValuation": 36232.5,
      "lowStockCount": 0,
      "expiringBatchesCount": 0
    },
    "categoryValuation": { ... },
    "lowStockItems": [],
    "expiringBatches": [],
    "auditLogs": []
  }
  ```

#### `GET /api/inventory/export`
Streams an inventory export file (`csv` or `xls`).
- **Auth:** Bearer JWT (`inventoryPermissions.export`)
- **Query Params:** `format` (`csv` | `xls`, default `csv`)
- **Response `200`:** File attachment (`inventory-export.csv` or `inventory-export.xls`).

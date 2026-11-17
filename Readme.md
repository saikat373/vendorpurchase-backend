Analyzed route.ts:L1-60


Here is the **Node.js Backend & API Integration Gist** tailored to your current frontend (`Admin` / `Vendor` RBAC, `Kirana` / `Pharmacy` / `Mall` Inventory, Stock Transactions, Audit Logs, and Reports), designed to run on **SQLite (Testing)** and migrate cleanly to **MySQL (Production)**.

---

### 1. Recommended Stack (Zero-Rewrite SQLite → MySQL Switch)
- **Runtime & Framework:** Node.js + **Express** or **Fastify** (TypeScript)
- **ORM / Query Layer (Pick one):**
  - **Prisma** (`provider = "sqlite"` in test → `provider = "mysql"` in prod) — best for schema-first migrations & typed queries.
  - **Knex.js** or **Drizzle ORM** — if you prefer SQL-like query builders (`better-sqlite3` in dev/test, `mysql2` in prod).
- **Auth & Security:** `bcrypt` / `argon2` for password hashing, **JWT** (`jsonwebtoken`) in `Authorization: Bearer <token>` or `HttpOnly` cookie, plus middleware checking `user.isActive === true` on every request.
- **Validation:** `zod` (reuse the exact validation rules from [lib/inventory-service.ts](file:///d:/react-projects/vendorpurchase/lib/inventory-service.ts)).

---

### 2. Database Schema (SQLite Testing ↔ MySQL Production)

Keep column types portable across SQLite and MySQL:

| Table | Key Columns | Purpose |
| :--- | :--- | :--- |
| **`users`** | `id`, `account_type` (`Admin` \| `Vendor`), `name`, `email` (UNIQUE), `password_hash`, `company`, `role`, `is_active` (`BOOLEAN`), `approved`, `allowed_verticals` (`JSON`), `allowed_locations` (`JSON`), `user_permissions` (`JSON`), `inventory_permissions` (`JSON`), `menu_permissions` (`JSON`), `module_permissions` (`JSON`), `created_at`, `updated_at` | Stores Admins & Admin-created Vendors. If `is_active = false`, login & API access are blocked. |
| **`inventory_products`** | `id`, `sku` (UNIQUE), `barcode`, `inventory_category` (`Grocery` \| `Pharmacy` \| `Mall`), `product_name`, `brand`, `product_category`, `supplier`, `purchase_price`, `selling_price`, `mrp`, `gst_percent`, `unit_of_measurement`, `stock_quantity`, `minimum_stock_level`, `maximum_stock_level`, `status`, `store_location`, `category_fields` (`JSON` for Kirana/Mall metadata), `created_at`, `updated_at` | Core product catalog scoped by `inventory_category` and `store_location`. |
| **`pharmacy_batches`** | `id`, `product_id` (FK), `batch_number`, `manufacturing_date`, `expiry_date`, `quantity`, `purchase_price`, `selling_price`, `mrp`, `location` | Multi-batch stock, expiry, and pricing for `Pharmacy` items. |
| **`stock_transactions`** | `id`, `reference_number`, `product_id` (FK), `batch_number`, `transaction_type` (`ADDITION` \| `REDUCTION` \| `ADJUSTMENT` \| `TRANSFER`), `quantity`, `previous_quantity`, `new_quantity`, `reason`, `performed_by_user_id`, `created_at` | Immutable stock movement ledger. |
| **`inventory_audit_logs`** | `id`, `entity_type`, `entity_id`, `operation`, `before_snapshot` (`JSON`), `after_snapshot` (`JSON`), `performed_by_user_id`, `created_at` | Immutable before/after audit trail (no hard deletes). |

---

### 3. Node.js REST API Endpoints (Matching Frontend Contracts)

#### A. Authentication & Admin Vendor Management (replaces [lib/auth-storage.ts](file:///d:/react-projects/vendorpurchase/lib/auth-storage.ts))
- `POST /api/auth/login` — Validates `email`, `password`, `accountType` (`Admin` \| `Vendor`), and **`is_active === true`**. Returns `{ token, user }`.
- `GET /api/auth/me` — Returns current user & live permissions from DB (so if Admin revokes a Vendor's permission or deactivates them, it takes effect immediately).
- `GET /api/admin/vendors` *(Admin only)* — Paginated + searchable list of users/vendors.
- `POST /api/admin/vendors` *(Admin only)* — Creates a new Vendor with hashed password, initial `is_active`, `allowedVerticals`, and default restricted permissions.
- `PATCH /api/admin/vendors/:id/status` *(Admin only)* — Toggles `is_active` (`true` / `false`).
- `PATCH /api/admin/vendors/:id/permissions` *(Admin only)* — Updates `allowedVerticals`, `userPermissions`, `inventoryPermissions`, `menuPermissions`, `modulePermissions`.

#### B. Inventory & Stock (keeps exact contract of `app/api/inventory/*`)
- `GET /api/inventory` — Server-side filter (`category`, `search`, `stockStatus`, `expiryStatus`, `dateFrom`, `dateTo`), sort, pagination, and vertical RBAC enforcement.
- `POST /api/inventory` — Creates product + initial `STOCK_ADDITION` transaction + audit log.
- `PUT /api/inventory/:id` — Updates product + writes before/after diff to `inventory_audit_logs`.
- `GET /api/inventory/stock` & `POST /api/inventory/stock` — Atomic stock addition/reduction/adjustment/transfer inside a **DB transaction** (`BEGIN ... COMMIT`).
- `GET /api/inventory/reports` — Dashboard KPIs, category valuation, low/threshold stock (`stock_quantity <= minimum_stock_level`), pharmacy expiry, and audit logs.
- `GET /api/inventory/export` — Streams `.xls` / `.csv` / `.pdf` exports.

---

### 4. Frontend Integration Plan
1. **Create a single API client (`lib/api-client.ts`)**:
   - Configure `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000` in `.env.local`.
   - Attach `Authorization: Bearer <jwt>` automatically on every `fetch` call (replacing the current `x-user-context` header and `localStorage` user store).
   - Handle `401 Unauthorized` / `403 Inactive` globally by clearing session and redirecting to `/login`.
2. **Swap storage calls**:
   - [components/auth-page.tsx](file:///d:/react-projects/vendorpurchase/components/auth-page.tsx): Call `POST /api/auth/login` instead of `readUsers()` / `hashPassword()`.
   - [components/dashboard-page.tsx](file:///d:/react-projects/vendorpurchase/components/dashboard-page.tsx) & [components/user-permission-module.tsx](file:///d:/react-projects/vendorpurchase/components/user-permission-module.tsx): Call `/api/auth/me` and `/api/admin/vendors/*` instead of `localStorage`.
   - [components/inventory-module.tsx](file:///d:/react-projects/vendorpurchase/components/inventory-module.tsx): Point `/api/inventory*` calls to `apiClient` (the response shapes `items`, `pagination`, `facets`, `transaction` already match!).

---

### 5. SQLite (Testing) → MySQL (Production) Migration Notes
1. **Environment-driven DB config:**
   - `.env.test` → `DB_CLIENT=sqlite3`, `DATABASE_URL="file:./dev.db"`
   - `.env.production` → `DB_CLIENT=mysql2`, `DATABASE_URL="mysql://user:pass@host:3306/vendorpurchase"`
2. **Concurrency & Stock Locking:**
   - SQLite serializes writes at the database level during `BEGIN IMMEDIATE` transactions.
   - In **MySQL (InnoDB)**, use `SELECT ... FOR UPDATE` inside `db.transaction(...)` when modifying `stock_quantity` or `pharmacy_batches.quantity` to prevent race conditions during concurrent POS/stock adjustments.
3. **Seed Script (`prisma/seed.ts` or `seeds/seed.ts`):**
   - Read [data/dummy-credentials.json](file:///d:/react-projects/vendorpurchase/data/dummy-credentials.json) and `lib/inventory-seed.ts` to seed the initial `Admin`, `Vendor` accounts, and sample Kirana/Pharmacy/Mall inventory into both SQLite (test) and MySQL (staging/prod).
4. **Gotchas to avoid:**
   - Avoid SQLite-only syntax (`AUTOINCREMENT`, `strftime`); use UUIDs (`crypto.randomUUID()`) for primary keys and ISO timestamps / `TIMESTAMP` via your ORM.
   - Use `DECIMAL(12,2)` in MySQL for prices and stock quantities (`kg`/decimal splits) instead of floats.
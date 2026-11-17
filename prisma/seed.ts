import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const adminPasswordHash = await bcrypt.hash('Admin@123', 10);
  const vendorPasswordHash = await bcrypt.hash('Vendor@123', 10);

  const adminFullPermissions = {
    allowedVerticals: ['Grocery', 'Pharmacy', 'Mall'],
    allowedLocations: ['ALL', 'Main Store — Ground Floor', 'Warehouse A'],
    userPermissions: {
      canAddInventory: true,
      canNotifyVendors: true,
      canOverridePrice: true,
      canApproveUsers: true,
    },
    inventoryPermissions: {
      viewInventory: true,
      addInventory: true,
      editInventory: true,
      viewStock: true,
      adjustStock: true,
      exportInventory: true,
      viewStockHistory: true,
      viewReports: true,
    },
    menuPermissions: [
      'overview',
      'inventory',
      'inventory-hub',
      'store-floor',
      'profit-guard',
      'suppliers-khata',
      'retention',
      'gst-pulse',
      'user-permissions',
    ],
    modulePermissions: [
      'posBilling',
      'ocrScanner',
      'barcodeGenerator',
      'marginDrift',
      'auditLogs',
      'comboBuilder',
      'autoPo',
      'digitalKhata',
      'whatsappAi',
      'gstExport',
    ],
  };

  const admin = await prisma.user.upsert({
    where: { email: 'admin@vendorpurchase.local' },
    update: adminFullPermissions,
    create: {
      accountType: 'Admin',
      name: 'System Admin',
      email: 'admin@vendorpurchase.local',
      passwordHash: adminPasswordHash,
      company: 'VendorPurchase HQ',
      role: 'SuperAdmin',
      isActive: true,
      approved: true,
      ...adminFullPermissions,
    },
  });

  await prisma.user.upsert({
    where: { email: 'vendor@vendorpurchase.local' },
    update: {},
    create: {
      accountType: 'Vendor',
      name: 'Kirana & Pharmacy Vendor',
      email: 'vendor@vendorpurchase.local',
      passwordHash: vendorPasswordHash,
      company: 'Sunrise Retail',
      role: 'Vendor',
      isActive: true,
      approved: true,
      allowedVerticals: ['Grocery', 'Pharmacy'],
      allowedLocations: ['Main Store'],
      userPermissions: {},
      inventoryPermissions: { view: true, create: true, edit: true, stockAdjust: true, export: true },
      menuPermissions: { dashboard: true, inventory: true, reports: true },
      modulePermissions: { grocery: true, pharmacy: true },
    },
  });

  const sampleProducts = [
    {
      sku: 'GRO-RICE-001',
      barcode: '8901001000011',
      inventoryCategory: 'Grocery',
      productName: 'Basmati Rice Premium',
      brand: 'India Gate',
      productCategory: 'Staples',
      supplier: 'Agro Foods Ltd',
      purchasePrice: 85.0,
      sellingPrice: 110.0,
      mrp: 120.0,
      gstPercent: 5,
      unitOfMeasurement: 'kg',
      stockQuantity: 150.5,
      minimumStockLevel: 25,
      maximumStockLevel: 500,
      storeLocation: 'Main Store',
      categoryFields: { looseItem: true, shelfLifeDays: 365 },
    },
    {
      sku: 'PHM-PARA-500',
      barcode: '8902002000022',
      inventoryCategory: 'Pharmacy',
      productName: 'Paracetamol 500mg Strip',
      brand: 'Dolo',
      productCategory: 'Analgesics',
      supplier: 'MedPlus Distributors',
      purchasePrice: 18.0,
      sellingPrice: 28.0,
      mrp: 32.0,
      gstPercent: 12,
      unitOfMeasurement: 'strip',
      stockQuantity: 80,
      minimumStockLevel: 20,
      maximumStockLevel: 300,
      storeLocation: 'Main Store',
      categoryFields: { schedule: 'OTC', prescriptionRequired: false },
    },
    {
      sku: 'MAL-SHRT-001',
      barcode: '8903003000033',
      inventoryCategory: 'Mall',
      productName: 'Cotton Casual Shirt',
      brand: 'UrbanThread',
      productCategory: 'Apparel',
      supplier: 'ThreadWorks',
      purchasePrice: 550.0,
      sellingPrice: 999.0,
      mrp: 1299.0,
      gstPercent: 12,
      unitOfMeasurement: 'pcs',
      stockQuantity: 40,
      minimumStockLevel: 10,
      maximumStockLevel: 200,
      storeLocation: 'Warehouse A',
      categoryFields: { size: 'L', color: 'Navy', season: 'All-Season' },
    },
  ];

  for (const item of sampleProducts) {
    const existing = await prisma.inventoryProduct.findUnique({ where: { sku: item.sku } });
    if (!existing) {
      const created = await prisma.inventoryProduct.create({ data: item });

      if (item.inventoryCategory === 'Pharmacy') {
        await prisma.pharmacyBatch.create({
          data: {
            productId: created.id,
            batchNumber: 'BATCH-2026-A1',
            manufacturingDate: new Date('2026-01-15T00:00:00Z'),
            expiryDate: new Date('2027-12-31T00:00:00Z'),
            quantity: item.stockQuantity,
            purchasePrice: item.purchasePrice,
            sellingPrice: item.sellingPrice,
            mrp: item.mrp,
            location: item.storeLocation,
          },
        });
      }

      await prisma.stockTransaction.create({
        data: {
          referenceNumber: `SEED-${item.sku}`,
          productId: created.id,
          batchNumber: item.inventoryCategory === 'Pharmacy' ? 'BATCH-2026-A1' : null,
          transactionType: 'ADDITION',
          quantity: item.stockQuantity,
          previousQuantity: 0,
          newQuantity: item.stockQuantity,
          reason: 'Initial database seed',
          performedByUserId: admin.id,
        },
      });
    }
  }

  console.log('Seed completed successfully.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

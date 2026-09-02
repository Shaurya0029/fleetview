/**
 * Real-world warehouse scenario addendum: gives the six static obstacle
 * rectangles (see obstacles.ts) narrative identities, and defines the small
 * cargo catalog robots draw from while working. Purely additive/illustrative
 * — a generic large e-commerce fulfillment warehouse, not modeled on any
 * real company's actual facility, branding, or product names.
 */

export type CargoCategory = "electronics" | "apparel" | "home_goods" | "groceries";

export interface WarehouseZone {
  /** Index into shared OBSTACLES — this zone's rectangle. */
  obstacleIndex: number;
  name: string;
  kind: "storage" | "packing" | "shipping" | "charging";
  category?: CargoCategory;
}

/** Matches OBSTACLES' 6 rectangles 1:1 (obstacles.ts): 3 left rows, 1 center rack, 2 right rows. */
export const WAREHOUSE_ZONES: WarehouseZone[] = [
  { obstacleIndex: 0, name: "Zone A — Electronics", kind: "storage", category: "electronics" },
  { obstacleIndex: 1, name: "Zone B — Apparel", kind: "storage", category: "apparel" },
  { obstacleIndex: 2, name: "Zone C — Home Goods", kind: "storage", category: "home_goods" },
  { obstacleIndex: 3, name: "Packing Station", kind: "packing" },
  { obstacleIndex: 4, name: "Shipping Dock", kind: "shipping" },
  { obstacleIndex: 5, name: "Charging Bay", kind: "charging" },
];

export interface CargoCatalogItem {
  sku: string;
  label: string;
  category: CargoCategory;
}

/** Small, realistic, generic catalog — not tied to any real retailer's actual SKUs or products. */
export const CARGO_CATALOG: CargoCatalogItem[] = [
  { sku: "ELEC-4471", label: "Wireless Earbuds", category: "electronics" },
  { sku: "ELEC-2290", label: "Bluetooth Speaker", category: "electronics" },
  { sku: "ELEC-3315", label: "Laptop Stand", category: "electronics" },
  { sku: "ELEC-1187", label: "Phone Charger", category: "electronics" },
  { sku: "ELEC-5502", label: "Smart Watch", category: "electronics" },
  { sku: "APRL-1042", label: "T-Shirt 5-Pack", category: "apparel" },
  { sku: "APRL-2233", label: "Running Shoes", category: "apparel" },
  { sku: "APRL-3389", label: "Winter Jacket", category: "apparel" },
  { sku: "APRL-4410", label: "Yoga Pants", category: "apparel" },
  { sku: "APRL-5567", label: "Baseball Cap", category: "apparel" },
  { sku: "HOME-1123", label: "Ceramic Mug Set", category: "home_goods" },
  { sku: "HOME-2245", label: "Throw Blanket", category: "home_goods" },
  { sku: "HOME-3367", label: "LED Desk Lamp", category: "home_goods" },
  { sku: "HOME-4489", label: "Storage Bin Set", category: "home_goods" },
  { sku: "HOME-5501", label: "Cutting Board Set", category: "home_goods" },
  { sku: "GROC-1001", label: "Bottled Water (Case)", category: "groceries" },
  { sku: "GROC-2002", label: "Snack Variety Pack", category: "groceries" },
  { sku: "GROC-3003", label: "Coffee Beans, 2lb", category: "groceries" },
];

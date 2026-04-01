import cookieYetiIcon from "@/assets/cookieyeti-icon.png";
import inventoryproofIcon from "@/assets/inventoryproof-icon.png";
import hokuBottle from "@/assets/hoku-bottle.png";
import neckpilotIcon from "@/assets/neckpilot-icon.png";
import schoolpilotIcon from "@/assets/schoolpilot-icon.png";
import hoacureIcon from "@/assets/hoacure-icon.png";
import confeshIcon from "@/assets/confesh-icon.png";
import { Droplets } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ProductCategory = "Privacy" | "Productivity" | "Education" | "Home" | "Social" | "Health";
export type ProductStatus = "Live" | "Coming Soon" | "In Development";

export interface Product {
  id: string;
  name: string;
  description: string;
  /** Internal route or external URL */
  href: string;
  /** Lucide icon component (used when no image) */
  icon?: LucideIcon;
  /** Path to an image asset */
  image?: string;
  category: ProductCategory;
  status: ProductStatus;
  /** App Store URL if available */
  appStoreUrl?: string;
  /** Web companion / dashboard URL */
  webUrl?: string;
}

/**
 * Single source of truth for all Bestly products.
 * Update this array and every surface (Links page, nav dropdown, Products page) updates automatically.
 */
export const products: Product[] = [
  {
    id: "cookie-yeti",
    name: "Cookie Yeti",
    description: "Dismiss cookie banners instantly. Browse cleaner, faster, and more privately.",
    href: "/cookie-yeti",
    image: cookieYetiIcon,
    category: "Privacy",
    status: "Coming Soon",
  },
  {
    id: "inventory-proof",
    name: "InventoryProof",
    description: "Walk through your home. Get an insurance-ready inventory report in minutes, powered by AI.",
    href: "https://inventoryproof.com",
    image: inventoryproofIcon,
    category: "Home",
    status: "Live",
    webUrl: "https://inventoryproof.com",
  },
  {
    id: "hoku",
    name: "HOKU",
    description: "Pharmaceutical-grade skincare, simplified. A daily facial mist backed by science.",
    href: "https://hoku-clean.com",
    image: hokuBottle,
    icon: Droplets,
    category: "Health",
    status: "Coming Soon",
    webUrl: "https://hoku-clean.com",
  },
  {
    id: "neckpilot",
    name: "NeckPilot",
    description: "Posture awareness powered by AirPods. Real-time feedback and gentle alerts.",
    href: "/neckpilot",
    image: neckpilotIcon,
    category: "Productivity",
    status: "Coming Soon",
  },
  {
    id: "schoolpilot",
    name: "SchoolPilot",
    description: "Navigate school life with ease — schedules, grades, and assignments in one place.",
    href: "/products",
    image: schoolpilotIcon,
    category: "Education",
    status: "In Development",
  },
  {
    id: "hoa-cure",
    name: "HOA Cure",
    description: "Simplify HOA management. Violations, dues, and community comms — finally under control.",
    href: "/products",
    image: hoacureIcon,
    category: "Home",
    status: "In Development",
  },
  {
    id: "confesh",
    name: "Confesh",
    description: "Share what's really on your mind. Anonymous, private, and judgment-free.",
    href: "/products",
    image: confeshIcon,
    category: "Social",
    status: "In Development",
  },
];

export const categories: ProductCategory[] = ["Privacy", "Productivity", "Education", "Home", "Social", "Health"];

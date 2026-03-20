import cookieYetiIcon from "@/assets/cookieyeti-icon.png";
import inventoryproofIcon from "@/assets/inventoryproof-icon.png";
import hokuBottle from "@/assets/hoku-bottle.png";
import neckpilotIcon from "@/assets/neckpilot-icon.png";
import { Droplets } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface Product {
  name: string;
  description: string;
  /** Internal route or external URL */
  href: string;
  /** Lucide icon component (used when no image) */
  icon?: LucideIcon;
  /** Path to an image asset */
  image?: string;
}

/**
 * Single source of truth for all Bestly products.
 * Update this array and every surface (Links page, nav dropdown, Products page) updates automatically.
 */
export const products: Product[] = [
  {
    name: "Cookie Yeti",
    description: "Privacy-focused cookie consent handler",
    href: "/cookie-yeti",
    image: cookieYetiIcon,
  },
  {
    name: "InventoryProof",
    description: "AI-powered home inventory documentation",
    href: "https://inventoryproof.com",
    image: inventoryproofIcon,
  },
  {
    name: "HOKU",
    description: "Premium hypochlorous acid skincare",
    href: "https://hoku-clean.com",
    image: hokuBottle,
    icon: Droplets,
  },
  {
    name: "NeckPilot",
    description: "Posture awareness powered by AirPods",
    href: "/neckpilot",
    image: neckpilotIcon,
  },
];

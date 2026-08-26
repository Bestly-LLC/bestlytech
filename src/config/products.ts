import cookieYetiIcon from "@/assets/cookieyeti-icon.png";
import inventoryproofIcon from "@/assets/inventoryproof-icon.png";
import hokuBottle from "@/assets/hoku-bottle.png";
import neckpilotIcon from "@/assets/neckpilot-icon.png";
import schoolpilotIcon from "@/assets/schoolpilot-icon.png";
import hoacureIcon from "@/assets/hoacure-icon.png";
import confeshIcon from "@/assets/confesh-icon.png";
import { Droplets, Gem, HeartHandshake, Compass, Leaf, Flower2, ShoppingBag } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ProductCategory =
  | "Privacy"
  | "Productivity"
  | "Education"
  | "Home"
  | "Social"
  | "Health"
  | "Family"
  | "Client Work";
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
  /** Key features for showcase cards */
  features?: string[];
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
    status: "Live",
    appStoreUrl: "https://apps.apple.com/us/app/cookie-yeti/id6759732250",
    features: ["Auto-dismiss cookie popups", "Privacy-first preferences", "Works on Chrome, iPhone & iPad", "Community-powered patterns"],
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
    features: ["AI-powered item detection", "Insurance-ready PDF reports", "Room-by-room walkthrough", "Cloud backup & sharing"],
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
    features: ["Pharmaceutical-grade formula", "Single-step daily routine", "Dermatologist reviewed", "Clean ingredients only"],
  },
  {
    id: "neckpilot",
    name: "NeckPilot",
    description: "Posture awareness powered by AirPods. Real-time feedback and gentle alerts.",
    href: "/neckpilot",
    image: neckpilotIcon,
    category: "Productivity",
    status: "Coming Soon",
    features: ["AirPods motion tracking", "Real-time posture alerts", "Daily posture score", "Gentle haptic reminders"],
  },
  {
    id: "schoolpilot",
    name: "SchoolPilot",
    description: "One app for parents and students that pulls everything from your school's existing system into a single place. Grades, attendance, lunch balance, assignments.",
    href: "/products",
    image: schoolpilotIcon,
    category: "Education",
    status: "In Development",
    features: ["Unified school view", "Reads your existing SIS", "FERPA-aligned", "Parent + student modes"],
  },
  {
    id: "hoascope",
    name: "HOAscope",
    description: "Simplify HOA management. Violations, dues, and community comms — finally under control.",
    href: "/products",
    image: hoacureIcon,
    category: "Home",
    status: "In Development",
    features: ["Violation tracking", "Automated dues collection", "Community announcements", "Board meeting tools"],
  },
  {
    id: "confesh",
    name: "Confesh",
    description: "Share what's really on your mind. Anonymous, private, and judgment-free.",
    href: "/products",
    image: confeshIcon,
    category: "Social",
    status: "In Development",
    features: ["Fully anonymous posting", "End-to-end encryption", "No account required", "Community moderation"],
  },
  {
    id: "el-dora",
    name: "El D'Ora",
    description:
      "Lab-grown diamond jewelry. Brand direction, product imagery, and a 190-piece storefront.",
    href: "https://eldoraluxe.com",
    icon: Gem,
    category: "Client Work",
    status: "Live",
    features: [
      "190+ piece catalog",
      "Art-directed product imagery",
      "Full brand identity",
      "Storefront build",
    ],
  },
  {
    id: "parentiq",
    name: "ParentIQ",
    description:
      "Co-parenting app built for peace of mind between households.",
    href: "https://parentiq.io",
    icon: HeartHandshake,
    category: "Family",
    status: "Live",
    features: [
      "Shared household calendar",
      "Neutral, logged communication",
      "Expense tracking",
      "Built for two homes",
    ],
  },
  {
    id: "captains-log",
    name: "Captain's Log",
    description:
      "A sailing app with real marine weather, plus a command center that plots live ship traffic on a map.",
    href: "https://captainslog-command.higgsfield.app",
    icon: Compass,
    category: "Productivity",
    status: "Live",
    features: [
      "Live marine weather",
      "Real-time vessel tracking",
      "iOS app + web command center",
      "Shipped through Apple review",
    ],
  },
  {
    id: "purely-hunza",
    name: "Purely Hunza",
    description: "Food brand built and launched from a blank page.",
    href: "https://purelyhunza.com",
    icon: Leaf,
    category: "Client Work",
    status: "Live",
    features: [
      "Brand identity from scratch",
      "Storefront and checkout",
      "Product photography",
      "Launch campaign",
    ],
  },
  {
    id: "golden-hour-garden",
    name: "Golden Hour Garden Design",
    description:
      "High-end landscape studio in Florida. Portfolio gallery, a booking form that takes photo uploads, and email on their own domain.",
    href: "https://goldenhourgardendesign.com",
    icon: Flower2,
    category: "Client Work",
    status: "Live",
    features: [
      "Portfolio gallery",
      "Booking form with photo uploads",
      "Email on their own domain",
      "Design, build, and hosting",
    ],
  },
  {
    id: "the-shift-shop",
    name: "The Shift Shop",
    description:
      "Moved an entire business onto a new store, then added an Amazon shop and TikTok Shop so the same catalog sells in three places.",
    href: "https://theshift.shop",
    icon: ShoppingBag,
    category: "Client Work",
    status: "Live",
    features: [
      "Full platform migration",
      "Amazon marketplace listing",
      "TikTok Shop integration",
      "One catalog, three channels",
    ],
  },
];

export const categories: ProductCategory[] = [
  "Privacy",
  "Productivity",
  "Education",
  "Family",
  "Home",
  "Social",
  "Health",
  "Client Work",
];

/**
 * True when a product href must be rendered as a plain <a>: an external brand
 * site, or /work (a static page in public/ that lives outside the SPA router).
 */
export const isExternalHref = (href: string) =>
  href.startsWith("http") || href.startsWith("/work");

/**
 * Plain battery glyph for the admin: the fill follows the level, never a charging bolt.
 * Charging state is always said in words next to it ("Charging", "Plugged in").
 */
import { Battery, BatteryFull, BatteryLow, BatteryMedium, type LucideProps } from "lucide-react";

export function BatteryIcon({ pct, ...props }: LucideProps & { pct?: number | null }) {
  const Icon = pct == null ? Battery : pct <= 20 ? BatteryLow : pct <= 65 ? BatteryMedium : BatteryFull;
  return <Icon aria-hidden {...props} />;
}

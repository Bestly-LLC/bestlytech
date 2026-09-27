/**
 * Battery glyph for the admin. The fill follows the level; the lightning bolt appears only while
 * the thing is actually charging (never as decoration on a label or a header).
 */
import { Battery, BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, type LucideProps } from "lucide-react";

export function BatteryIcon({ pct, charging, ...props }: LucideProps & { pct?: number | null; charging?: boolean }) {
  const Icon = charging ? BatteryCharging : pct == null ? Battery : pct <= 20 ? BatteryLow : pct <= 65 ? BatteryMedium : BatteryFull;
  return <Icon aria-hidden {...props} />;
}

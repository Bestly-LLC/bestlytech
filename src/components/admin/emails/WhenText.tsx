import { dayPart, isToday, timePart } from "@/lib/email/sentFormat";

/** "12:04 PM" today, "Oct 19, 12:04 PM" otherwise (always with the date when `withDay`). Each number stays glued to its unit. */
export function WhenText({ iso, withDay }: { iso: string; withDay?: boolean }) {
  const t = timePart(iso);
  if (!t) return null;
  const showDay = withDay || !isToday(iso);
  return (
    <>
      {showDay && <><span className="whitespace-nowrap">{dayPart(iso)},</span>{" "}</>}
      <span className="whitespace-nowrap">{t}</span>
    </>
  );
}

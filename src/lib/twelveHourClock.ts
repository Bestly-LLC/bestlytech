/**
 * Every clock time on the site reads 12-hour ("3:05 PM"), never military ("15:05"),
 * whatever the browser's locale is. (Jared, 2026-09-22)
 *
 * One place, not a sweep of every call: Date#toLocaleString / toLocaleTimeString and
 * Intl.DateTimeFormat get hour12: true added unless the caller set hour12 or hourCycle
 * itself. Code that needs a 0-23 number for arithmetic already says hourCycle "h23"
 * or hour12: false, so it is left alone. The same shim is inlined in Studio's pages.
 */
type Opts = Intl.DateTimeFormatOptions | undefined;
const add = (o: Opts): Intl.DateTimeFormatOptions =>
  o && (o.hour12 !== undefined || o.hourCycle) ? o : { ...(o ?? {}), hour12: true };

export function installTwelveHourClock() {
  const w = window as unknown as { __h12?: boolean };
  if (w.__h12) return;
  w.__h12 = true;
  const D = Date.prototype;
  const s = D.toLocaleString, t = D.toLocaleTimeString;
  D.toLocaleString = function (this: Date, l?: Intl.LocalesArgument, o?: Opts) { return s.call(this, l, add(o)); };
  D.toLocaleTimeString = function (this: Date, l?: Intl.LocalesArgument, o?: Opts) { return t.call(this, l, add(o)); };
  const F = Intl.DateTimeFormat;
  Intl.DateTimeFormat = new Proxy(F, {
    construct: (T, a) => new T(a[0], add(a[1])),
    apply: (T, _this, a) => (T as unknown as (l?: unknown, o?: Opts) => Intl.DateTimeFormat)(a[0], add(a[1])),
  });
}

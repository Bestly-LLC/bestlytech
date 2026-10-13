# Delivery trip page — opusplan (2026-10-12)

Third guest trip page, for every Turo trip that is **not LAX and not home pickup** (hotels, pods,
Union Station, custom addresses). Leo-first, headless, built fresh. Look comes from the printed
delivery card ("Hi, I'm Leo." cream card, `DELIVERY-2x3.5-front-and-back.pdf`).

Jared's calls (2026-10-12):
- Light cream look, like the card.
- Leo is the page. Headless (our own UI over `@elevenlabs/client`, no widget) and agentic (Leo collects
  the room number and front-desk info and hands it to Jared).
- Hotels need the room number plus any helpful delivery info.
- Return = the same place as pickup.
- Preview link first; Jared approves before it goes live.

First real trip: reservation 62275681, Best Western Plus Sunset Plaza, starts **Tue Oct 13, 8:00 PM PT**.

## 0. The rule that keeps production safe

There is one Supabase project. Production's `LaxGuest.tsx` renders the LAX page for any `kind` that is
not `"home"`. So the server must **never change `kind`**. Delivery trips keep `kind: "home"` (keys,
reminders, key gating keep working exactly as today) and get two NEW fields:

```jsonc
// added to lax_guest_public(...) for delivery trips only
"place": "delivery",                 // "lax" | "home" | "delivery" — new field, all trips
"delivery": {
  "location_id": "best-western-sunset-plaza",
  "kind": "hotel",                   // hotel | pod | train | custom
  "name": "Best Western Plus Sunset Plaza Hotel",
  "short": "Best Western Sunset Plaza",
  "address": "8400 Sunset Blvd, West Hollywood, CA 90069",
  "lat": 34.0957, "lon": -118.3719,  // from turo_trips.pickup_lat/lon, else the location row
  "ask": ["room", "front_desk"],     // what Leo still needs to collect, empty when done
  "info": { "room": null, "front_desk": null, "parking": null, "eta": null,
            "reported_at": null, "via": null },     // via: "leo" | "page"
  "turo_instructions": "...",        // raw.location.pickupAndReturn.deliveryInstructions
  "return_note": "Bring it back here, same place."
}
```

Old frontend ignores `place`/`delivery`. New frontend switches on `pub.place === "delivery"` first.

## 1. Server (one migration + trip-voice + ElevenLabs)

Migration `supabase/migrations/20261013010000_delivery_trips.sql`, append-only, additive:

1. **`delivery_locations`** table: `id text pk`, `kind`, `name`, `short`, `match` (text[] of ilike
   patterns), `address`, `lat`, `lon`, `ask text[]`, `parking_note`, `fee`, `active`. Seed Jared's 8:
   | id | kind | ask | fee |
   |---|---|---|---|
   | space-pods-hollywood | pod | room (pod #), front_desk | $40 |
   | hyatt-regency-lax | hotel | room, front_desk | $70 |
   | courtyard-lax-century | hotel | room, front_desk | $70 |
   | sheraton-gateway-lax | hotel | room, front_desk | $70 |
   | best-western-sunset-plaza | hotel | room, front_desk | $45 |
   | sls-beverly-hills | hotel | room, front_desk | $35 |
   | union-station | train | eta | $120 |
   | custom | custom | room (unit/apt, optional), parking | — |
   Addresses/lat/lon from a quick web check; leave null if unsure (trip lat/lon wins anyway).
   RLS on, admin read/write only; reads go through SECURITY DEFINER functions.
2. **`trip_delivery_info`** table keyed by `reservation_id`: `room`, `front_desk`, `parking`, `eta`,
   `reported_at`, `via`, `updated_at`. Add `privacy_data_map` rows (room/notes = `blank` at retention).
3. **`trip_place(p_reservation bigint) returns text`**: `'lax'` if `airport_code='LAX'` or
   `raw.location.type='AIRPORT'`; `'home'` if `raw.location.type='STREET'` and
   `coalesce((raw->'location'->>'deliveryLocation')::bool,false)=false`; else `'delivery'`.
   Do NOT use the `~* '(kings|90069)'` rule — the Best Western is also 90069.
   **`trip_delivery_location(p_reservation)`**: match `raw.location.name` against `match`, else
   nearest active row within 600 ft of pickup lat/lon, else `custom`.
4. **`trip_place_for(p_token text)`**: like `lax_trip_kind_for` but returns place (for the splash in
   `trip.html`). Add to `security_public_rpcs`.
5. **`lax_guest_public`**: fetch the live body with `pg_get_functiondef`, save it to `bestly_memory`
   as an UNDO row (`house/turo/delivery-undo-2026-10-13`), then `CREATE OR REPLACE` adding only
   `place` + `delivery` (section 0). Same for `lax_guest_admin_list` (add `place`, `delivery_short`,
   `delivery_info`). Do not change any other branch.
6. **`trip_delivery_report(p_token text, p_room text, p_front_desk text, p_parking text, p_eta text,
   p_via text default 'page')`**: token-bound, trims to 200 chars each, upserts, then notifies Jared
   **signed by Leo** through the same path Leo's `notify_host` uses, e.g.
   `Leo: Best Western guest (res 62275681) is in room 214. Front desk: self-park in the back lot, $25/night.`
   This is "a real person waiting" (the guest is waiting on the delivery), so it may interrupt.
   Add to `security_public_rpcs`.
7. **Reminder safety (live, before preview):** the home reminder email/Turo text names N Kings Rd.
   Hold it for delivery trips: make `lax_home_due` skip rows where `trip_place(...)='delivery'`.
   Reversible, and stops a wrong-address message going to tomorrow's guest. Save UNDO first.
8. Demo: `lax_guest_public('demo-delivery')` path if demos are DB-side; otherwise handled in
   `demo.tsx` (frontend). Check which.

`trip-voice` edge function:
- Accept `demo-delivery` in the demo regex.
- Session dynamic vars: `pickup_place` = `pub.place ?? pub.kind`; add `delivery_name`,
  `delivery_kind`, `delivery_missing` (comma list of `ask`), `return_place`.
- New Leo tool **`delivery_info`** (webhook, same key-binding as the other 6 tools): `op: "get"`
  returns what's known/missing; `op: "save"` with room/front_desk/parking/eta calls
  `trip_delivery_report(..., via => 'leo')`. Leo never touches keys/unlock through this tool.

ElevenLabs (Leo agent): register the `delivery_info` tool and add a prompt section that only applies
when `pickup_place == "delivery"`: greet by place name; if `delivery_missing` is not empty, the one
offer is "What's your room number?" (hotel/pod), "When does your train get in?" (train), or "Any
unit number or parking notes?" (custom); ask what the front desk said about parking (garage, valet,
fees, overnight rules); save with `delivery_info`; confirm back in one line; tell them Jared drives
the car over, spends about 10 minutes on photos, and the key turns on after his check-in. Return is
the same place. Use a new agent version; do not change behavior for lax/home.

Watchdog (Scout): extend `trip-health` to also check `/t/demo-delivery` and that `lax_guest_public`
returns `place` for any live delivery trip; failures go to Scout like the existing checks.

## 2. Frontend — `src/pages/lax/DeliveryGuest.tsx` (new)

Switch in `LaxGuest.tsx` before the home check:
`if (token && pub?.ok && pub.place === "delivery") return <DeliveryGuest .../>`.
Add `place?` and `delivery?` to `Pub`. Cache `tripkind:<token>` = `"delivery"` for the splash.

**Theme** (CSS vars on the root, light, from the card):
- bg: `radial-gradient(120% 70% at 50% 0%, #FFF8EC 0%, #F6EEDD 55%, #E9DCC2 100%)`
- ink `#13282A`, body `#4A5452`, label `#B8661F` (letter-spaced caps), dot `#E2733A`, star `#D99A2E`
- orb: `radial-gradient(circle at 35% 30%, #F8DDB0 0%, #EDB253 38%, #E57A3A 75%, #C9622E 100%)`
  with a feathered glow (`box-shadow` / blurred pseudo, soft edges only, never a hard cut)
- titles Josefin Sans 700 (already loaded by Home via Helmet), body Inter.
- `--trip-accent: #E2733A`, `--trip-accent-2: #B8661F`, `--trip-bg: #F6EEDD`, `--trip-bar:
  rgba(246,238,221,0.95)`. Shared dark components must get readable light variants (check contrast;
  4.5:1 for text). `theme-color` `#F6EEDD`.

**Layout (phone first, top to bottom):**
1. Label `YOUR TURO TESLA · DELIVERED TO YOU`.
2. **The orb = Leo, headless.** Tap = start a voice session in place (no sheet). Orb breathes idle,
   reacts to Leo's speaking volume. Under it: `Hi, I'm Leo.` + one context line that changes with
   the trip moment, e.g. "Tell me your room number and I'll pass it to Jared." / "Jared's on his
   way." / "Your key is on. Need help with anything?" Live transcript bubbles under the orb,
   "Type instead" switches to text. Extract the session logic from `LeoScreen.tsx` into a shared
   `useLeoSession()` hook so LeoScreen and this page use the same code (no fork).
3. **"Ask me anything" chips** (from the card): Phone key not working · Where to eat + what to do ·
   Superchargers + what it costs · Self-driving + valet how-to · Return steps + charge needed.
   Tapping sends that question to Leo (starts text session if none).
4. **Delivery card**: place name, address (Maps link), and a checklist of what Leo still needs
   (`ask`), each filled live when known. Small "Rather type it?" fallback form posting to
   `trip_delivery_report(via 'page')`. When everything's in: "Got it. Jared has your room number."
5. **How delivery works** (3 steps, plain): Jared drives your Tesla over → about 10 minutes of photos
   → your phone key turns on. Show the current step from existing key/check-in state.
6. Key: reuse `KeySteps`/key state from `lax_guest_public` (same gating as home: no key until license
   + check-in).
7. Your car: climate/weather/charging (reuse, light-themed). Weather at the delivery lat/lon,
   `place` = short name.
8. Return: "Bring it back to <short>, same spot." + charge rule (same battery level as pickup) +
   SendToCar nav to the delivery address.
9. Footer like the card: 5 stars + "Loved the ride? A 5-star review on Turo helps a small host a
   ton." + "Or call Leo (310) 622-7052" + "POWERED BY BESTLY AGENTS".

Never show `...` truncation; numbers never split from units (`white-space: nowrap` on value+unit);
12-hour times; °F, mi.

**Other two-way switches to give a delivery entry:** `trip.html` splash (cream `#F6EEDD`, use
`trip_place_for`), `LinkDown` LOOK, `FindCar` THEME + copy, `TripCard` palette ("Delivery · <short>"),
`TagBar` variant, `InstallToast` icon, `places.ts` (`deliveryPlace(pub)`), `demo.tsx`
(`demo-delivery` → Best Western sample), `LeoWidget`/`LeoScreen` THEME (`delivery` light theme,
`kind` prop alongside `home` for compat), `AskSheet`/`leoChips` delivery chip bank,
`TuroEntry` (`/turo-key?src=delivery` gets the cream scene), assets `/public/wallet/delivery/`
(apple-touch-icon, og.png from the orb).

**Admin:** `GuestRow` pill `Delivery · <short>` plus room / front-desk notes when reported, and
the Turo message variant for delivery (the booked-trip message from this chat, with the trip link).

## 3. Preview and ship

- Branch `delivery-trip-page`, push, Vercel preview URL. Jared checks `/t/demo-delivery` and the real
  trip link on the preview. **Do not merge to main until he says yes** (his call overrides the
  repo's always-push rule for this change).
- DB changes are live immediately but invisible to prod (section 0). Undo rows saved in
  `bestly_memory` for every replaced function.
- After approval: merge, record decisions in `bestly_memory` (`house/turo/delivery-page`).

## Open (defaults taken, Jared can veto)
- Union Station asks for train arrival time instead of a room number.
- Custom addresses ask for a unit number (optional) and parking notes.
- Delivery fees are stored but not shown to guests.
- Return-zone checks (range check, car protect) still use home for delivery trips; delivery-aware
  return checks are a follow-up.

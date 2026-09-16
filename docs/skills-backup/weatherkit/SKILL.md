---
name: weatherkit
description: >-
  Integrate Apple WeatherKit into an app or backend. Use when a task involves
  fetching weather (current conditions, daily forecast) on Apple platforms or
  from a server. Covers BOTH paths: (A) native iOS/macOS WeatherKit Swift
  framework with entitlement-based auth, and (B) the WeatherKit REST API from a
  server (Deno/Supabase edge function, Node, etc.) using an ES256 JWT. Triggers:
  "add weather", "WeatherKit", "weather forecast", "current conditions",
  "weatherkit.apple.com", "weather edge function".
---

# Apple WeatherKit Integration

Two supported paths. Pick based on where the code runs.

| Path | Where it runs | Auth | Use when |
|------|---------------|------|----------|
| **A — Native framework** | iOS / macOS / watchOS app | WeatherKit **entitlement** (no keys in code) | The app is on an Apple platform and can call the framework directly. |
| **B — REST API** | Any server (Deno/Supabase, Node, Cloudflare) | **ES256 JWT** signed with a `.p8` key | Backend, web app, Android, or you want to centralize/proxy weather calls. |

Both hit the same Apple data. Reference implementations live in `reference/`.

---

## Apple Developer setup (do this first, both paths)

1. **App ID / Identifier** with the **WeatherKit** capability enabled
   (Certificates, Identifiers & Profiles → Identifiers).
2. **Path A only:** add the **WeatherKit** capability to the Xcode target
   (Signing & Capabilities → + Capability → WeatherKit). Auth is then automatic
   via the app's entitlement — no keys.
3. **Path B only:** create a **Services ID** and a **Key** with WeatherKit
   enabled, download the **`.p8` private key** (PKCS#8). You now have four values:
   - **Team ID** — 10-char team identifier.
   - **Service ID** — e.g. `com.yourco.app.weather`.
   - **Key ID** — 10-char ID of the `.p8` key.
   - **Private key** — the PEM contents of the `.p8` file (PKCS#8).

WeatherKit has a free tier (500k calls/month at time of writing) tied to your
Apple Developer membership; the REST API counts against the same quota.

---

## Path A — Native iOS WeatherKit (Swift)

```swift
import WeatherKit
import CoreLocation

let service = WeatherKit.WeatherService()
let weather = try await service.weather(for: CLLocation(latitude: lat, longitude: lon))
let current = weather.currentWeather
```

Key facts and gotchas (these bite people):

- **Temperature comes in the locale unit.** Convert explicitly:
  `Int(current.temperature.converted(to: .fahrenheit).value.rounded())`.
- **`feelsLikeTemperature` is NOT on `CurrentWeather`.** Don't reach for it on
  the current-conditions object — it isn't there. (Apparent temp is available
  via the REST API's `temperatureApparent`, see Path B.)
- **`current.humidity` is a `Double` in 0–1.** Multiply by 100 for a percentage.
- **Wind:** `current.wind.speed.value` (convert the `Measurement` for units).
- **Condition → SF Symbol:** `current.condition` is a `WeatherCondition` enum.
  Map it with a `switch` and always include `@unknown default` — Apple adds
  cases. See `reference/WeatherService.swift` for a complete, tested mapping.
- Wrap the call and rethrow a typed app error; network/entitlement failures
  surface here.

Full working file: **`reference/WeatherService.swift`**.

---

## Path B — WeatherKit REST API (server, ES256 JWT)

Sign a short-lived JWT, then GET the weather endpoint with it as a Bearer token.

**JWT shape (this is the part everyone gets wrong):**

```
header  = { "alg": "ES256", "kid": KEY_ID, "id": "TEAM_ID.SERVICE_ID" }
payload = { "iss": TEAM_ID, "iat": now, "exp": now + 3600, "sub": SERVICE_ID }
```

- `kid` is the **Key ID**; the extra `id` header field is `TEAM_ID.SERVICE_ID`.
- `iss` is the **Team ID**, `sub` is the **Service ID**.
- Sign with **ES256** (ECDSA P-256 / SHA-256).
- **Web Crypto's ECDSA signature is already raw `r||s`** — exactly the JWS
  format. Just base64url-encode it. **Do not** DER-encode (a common mistake
  that produces a signature WeatherKit rejects).
- Import the `.p8` as **PKCS#8**: strip the PEM header/footer + whitespace,
  base64-decode, `crypto.subtle.importKey("pkcs8", …, {name:"ECDSA", namedCurve:"P-256"}, false, ["sign"])`.

**Endpoint:**

```
GET https://weatherkit.apple.com/api/v1/weather/{lang}/{lat}/{lon}?dataSets=currentWeather,forecastDaily
Authorization: Bearer <jwt>
```

- `dataSets` can include `currentWeather`, `forecastDaily`, `forecastHourly`,
  `forecastNextHour`, `weatherAlerts` (alerts need a `&country=US` param).
- Apparent/"feels like" temp **is** available here as
  `currentWeather.temperatureApparent`.
- Forecast lives under `forecastDaily.days[]` with `temperatureMax` /
  `temperatureMin` / `conditionCode` / `forecastStart`.

**Secrets** (env vars in the reference function):
`WEATHERKIT_TEAM_ID`, `WEATHERKIT_SERVICE_ID`, `WEATHERKIT_KEY_ID`,
`WEATHERKIT_PRIVATE_KEY` (the PKCS#8 PEM, newlines preserved).

Set them on the platform. Supabase example:

```bash
supabase secrets set WEATHERKIT_TEAM_ID=XXXXXXXXXX \
  WEATHERKIT_SERVICE_ID=com.yourco.app.weather \
  WEATHERKIT_KEY_ID=YYYYYYYYYY \
  WEATHERKIT_PRIVATE_KEY="$(cat AuthKey_YYYYYYYYYY.p8)"
```

Full working Deno/Supabase edge function (JWT signing + CORS + response
shaping): **`reference/weather-edge-function.ts`**.

---

## Quick checklist

- [ ] WeatherKit capability enabled on the App ID.
- [ ] Path A: capability added to the Xcode target (entitlement present in build).
- [ ] Path B: Services ID + Key created, `.p8` downloaded, four secrets set.
- [ ] Path B: JWT header has `kid` + `id:"TEAM.SERVICE"`; signature is raw r‖s base64url (not DER).
- [ ] Handle `@unknown default` in any `WeatherCondition` switch.
- [ ] Remember humidity is 0–1; convert temperature units explicitly.
- [ ] Apple's TOS requires showing the **‘ Weather** attribution + a link to
      their legal/attribution page in any UI that displays WeatherKit data.

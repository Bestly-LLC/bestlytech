import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Convert a PEM private key (PKCS#8) to a CryptoKey for ES256 signing.
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");

  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  return crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

function base64url(input: Uint8Array | string): string {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createJWT(
  teamId: string,
  serviceId: string,
  keyId: string,
  privateKey: CryptoKey,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: keyId, id: `${teamId}.${serviceId}` };
  const payload = {
    iss: teamId,
    iat: now,
    exp: now + 3600,
    sub: serviceId,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(signingInput),
  );

  // The Web Crypto ECDSA signature is raw (r||s), which is exactly what JWS wants.
  const encodedSignature = base64url(new Uint8Array(signature));
  return `${signingInput}.${encodedSignature}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { latitude, longitude, language } = await req.json();

    if (typeof latitude !== "number" || typeof longitude !== "number") {
      return new Response(
        JSON.stringify({ error: "latitude and longitude are required numbers" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const teamId = Deno.env.get("WEATHERKIT_TEAM_ID");
    const serviceId = Deno.env.get("WEATHERKIT_SERVICE_ID");
    const keyId = Deno.env.get("WEATHERKIT_KEY_ID");
    const privateKeyPem = Deno.env.get("WEATHERKIT_PRIVATE_KEY");

    if (!teamId || !serviceId || !keyId || !privateKeyPem) {
      return new Response(
        JSON.stringify({ error: "WeatherKit secrets are not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const privateKey = await importPrivateKey(privateKeyPem);
    const jwt = await createJWT(teamId, serviceId, keyId, privateKey);

    const lang = language || "en";
    const url = `https://weatherkit.apple.com/api/v1/weather/${lang}/${latitude}/${longitude}?dataSets=currentWeather,forecastDaily`;

    const weatherRes = await fetch(url, {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    if (!weatherRes.ok) {
      const body = await weatherRes.text();
      console.error(`WeatherKit API error [${weatherRes.status}]: ${body}`);
      return new Response(
        JSON.stringify({ error: "WeatherKit request failed", status: weatherRes.status }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await weatherRes.json();
    const current = data.currentWeather;

    // Map Apple conditionCode to a simplified code for the frontend
    const days = (data.forecastDaily?.days ?? []).slice(0, 3).map((d: any) => ({
      date: (d.forecastStart ?? "").substring(0, 10),
      conditionCode: d.conditionCode,
      high: d.temperatureMax,
      low: d.temperatureMin,
    }));

    const result = {
      temperature: current?.temperature,
      temperatureFeelsLike: current?.temperatureApparent,
      conditionCode: current?.conditionCode,
      humidity: current?.humidity,
      windSpeed: current?.windSpeed,
      uvIndex: current?.uvIndex,
      asOf: current?.asOf,
      forecast: days,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Weather function error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

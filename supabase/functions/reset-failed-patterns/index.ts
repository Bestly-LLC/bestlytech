import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth: require maintenance secret OR valid admin Bearer token
  const secret = req.headers.get("x-maintenance-secret");
  const authHeader = req.headers.get("Authorization");
  let authorized = false;

  if (secret && secret === Deno.env.get("MAINTENANCE_SECRET")) {
    authorized = true;
  } else if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    const serviceRoleKey2 = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (token === serviceRoleKey2) {
      authorized = true;
    } else {
      const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData } = await authClient.auth.getUser(token);
      if (userData?.user) {
        const svcCheck = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey2);
        const { data: isAdmin } = await svcCheck.rpc("has_role", { _user_id: userData.user.id, _role: "admin" });
        if (isAdmin) authorized = true;
      }
    }
  }

  if (!authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);

  try {
    // Reset old permanently_failed domains (30+ days) that still have no active high-confidence pattern
    const { data, error } = await supabase.rpc("reset_old_failed_patterns" as any);

    if (error) {
      // If RPC doesn't exist yet, do it inline
      const { data: resetData, error: resetErr } = await supabase
        .from("missed_banner_reports")
        .update({ resolved: false, ai_attempts: 0, ai_processed_at: null } as any)
        .eq("resolved", true)
        .lt("resolved_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .select("domain");

      if (resetErr) throw resetErr;

      // Filter out domains that already have a good pattern
      let resetCount = 0;
      for (const row of resetData ?? []) {
        const { data: patterns } = await supabase
          .from("cookie_patterns")
          .select("id")
          .eq("domain", row.domain)
          .eq("is_active", true)
          .gte("confidence", 7)
          .limit(1);

        if (patterns && patterns.length > 0) {
          // Re-resolve — this domain already has a working pattern
          await supabase
            .from("missed_banner_reports")
            .update({ resolved: true } as any)
            .eq("domain", row.domain);
        } else {
          resetCount++;
        }
      }

      // Also clear old failed AI generation logs so they become candidates again
      await supabase
        .from("ai_generation_log")
        .delete()
        .in("status", ["permanently_failed", "generation_failed", "skipped_no_html"])
        .lt("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

      return new Response(
        JSON.stringify({ reset_count: resetCount, message: "Old failed domains reset for re-evaluation" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify(data),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

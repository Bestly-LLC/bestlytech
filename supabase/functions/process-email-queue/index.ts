// process-email-queue - Edge Function (Resend API version)
// Processes email queues and sends via Resend HTTP API
// Replaces the previous PrivateMail SMTP/nodemailer implementation

import { createClient } from "@supabase/supabase-js";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __svc = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", ...Object.values((() => { try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); } catch { return {}; } })()) as string[]].filter(Boolean));
const isSvc = (req: Request) => { const b = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim(); const a = (req.headers.get("apikey") ?? "").trim(); return __svc.has(b) || __svc.has(a); };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// --- Types ---
interface QueueMessage {
  msg_id: number;
  read_ct: number;
  enqueued_at: string;
  vt: string;
  message: {
    to: string;
    from?: string;
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
    headers?: Record<string, string>;
    metadata?: Record<string, unknown>;
  };
}

interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// --- Resend Email Sender ---
async function sendWithResend(
  msg: QueueMessage["message"],
  resendApiKey: string
): Promise<SendResult> {
  // bestly.tech domain verified in Resend on 2026-05-05
  const from = "Cookie Yeti <noreply@bestly.tech>";

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(msg.to) ? msg.to : [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text || undefined,
        reply_to: msg.replyTo || undefined,
        headers: msg.headers || undefined,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.message || data.error || `HTTP ${response.status}`,
      };
    }

    return {
      success: true,
      messageId: data.id,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// --- Main Handler ---
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // --- Auth ---
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = SB_SECRET;
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

    if (!RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY not configured");
    }

    // Verify authorization (service role key or Bearer token)
    const authHeader = req.headers.get("authorization") || "";
    if (!isSvc(req)) {
      // Allow if called via cron (no auth needed for scheduled invocations)
      // Supabase cron calls edge functions without auth headers
      const isCron =
        req.headers.get("x-supabase-cron") === "true" ||
        !authHeader;
      if (!isCron) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // --- Supabase Client ---
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // --- Get Configuration ---
    const { data: config } = await supabase
      .from("email_send_state")
      .select("*")
      .single();

    const batchSize = config?.batch_size || 10;
    const sendDelayMs = config?.send_delay_ms || 200;
    const authTtlMinutes = config?.auth_ttl_minutes || 15;
    const transactionalTtlMinutes = config?.transactional_ttl_minutes || 60;
    const maxRetries = 5;

    // --- Process Queues ---
    const results = {
      auth_emails: { sent: 0, failed: 0, expired: 0 },
      transactional_emails: { sent: 0, failed: 0, expired: 0 },
    };

    // Process auth_emails first (priority)
    await processQueue(
      supabase,
      "auth_emails",
      batchSize,
      authTtlMinutes,
      maxRetries,
      sendDelayMs,
      RESEND_API_KEY,
      results.auth_emails
    );

    // Then transactional_emails
    await processQueue(
      supabase,
      "transactional_emails",
      batchSize,
      transactionalTtlMinutes,
      maxRetries,
      sendDelayMs,
      RESEND_API_KEY,
      results.transactional_emails
    );

    return new Response(
      JSON.stringify({
        success: true,
        results,
        provider: "resend",
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("process-email-queue error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

// --- Queue Processing ---
async function processQueue(
  supabase: ReturnType<typeof createClient>,
  queueName: string,
  batchSize: number,
  ttlMinutes: number,
  maxRetries: number,
  sendDelayMs: number,
  resendApiKey: string,
  stats: { sent: number; failed: number; expired: number }
) {
  // Read batch from queue
  const { data: messages, error: readError } = await supabase.rpc(
    "read_email_batch",
    {
      queue_name: queueName,
      batch_size: batchSize,
      vt: 60, // visibility timeout 60 seconds
    }
  );

  if (readError) {
    console.error(`Error reading ${queueName}:`, readError);
    return;
  }

  if (!messages || messages.length === 0) return;

  console.log(`Processing ${messages.length} messages from ${queueName}`);

  for (const msg of messages as QueueMessage[]) {
    // Check TTL - skip expired messages
    const enqueuedAt = new Date(msg.enqueued_at).getTime();
    const now = Date.now();
    const ageMinutes = (now - enqueuedAt) / 60000;

    if (ageMinutes > ttlMinutes) {
      console.log(
        `Message ${msg.msg_id} expired (age: ${ageMinutes.toFixed(1)} min, TTL: ${ttlMinutes} min)`
      );
      // Move to DLQ
      await moveToDlq(supabase, queueName, msg, "expired");
      // Delete from queue
      await supabase.rpc("delete_email", {
        queue_name: queueName,
        message_id: msg.msg_id,
      });
      stats.expired++;
      continue;
    }

    // Check max retries
    if (msg.read_ct > maxRetries) {
      console.log(
        `Message ${msg.msg_id} exceeded max retries (${msg.read_ct}/${maxRetries})`
      );
      await moveToDlq(supabase, queueName, msg, "max_retries_exceeded");
      await supabase.rpc("delete_email", {
        queue_name: queueName,
        message_id: msg.msg_id,
      });
      stats.failed++;
      continue;
    }

    // Dedup check - skip if already sent
    const { data: existing } = await supabase
      .from("email_send_log")
      .select("id")
      .eq("queue_message_id", msg.msg_id)
      .eq("queue_name", queueName)
      .eq("status", "sent")
      .maybeSingle();

    if (existing) {
      console.log(`Message ${msg.msg_id} already sent, skipping`);
      await supabase.rpc("delete_email", {
        queue_name: queueName,
        message_id: msg.msg_id,
      });
      continue;
    }

    // Send via Resend
    const result = await sendWithResend(msg.message, resendApiKey);

    if (result.success) {
      // Log success
      await supabase.from("email_send_log").insert({
        queue_name: queueName,
        queue_message_id: msg.msg_id,
        to_email: msg.message.to,
        subject: msg.message.subject,
        status: "sent",
        provider: "resend",
        provider_message_id: result.messageId,
        sent_at: new Date().toISOString(),
      });

      // Delete from queue
      await supabase.rpc("delete_email", {
        queue_name: queueName,
        message_id: msg.msg_id,
      });

      stats.sent++;
      console.log(
        `✓ Sent to ${msg.message.to} via Resend (ID: ${result.messageId})`
      );
    } else {
      // Log failure
      await supabase.from("email_send_log").insert({
        queue_name: queueName,
        queue_message_id: msg.msg_id,
        to_email: msg.message.to,
        subject: msg.message.subject,
        status: "failed",
        provider: "resend",
        error: result.error,
        attempt: msg.read_ct,
      });

      stats.failed++;
      console.error(
        `✗ Failed to send to ${msg.message.to}: ${result.error}`
      );
    }

    // Rate limit between sends
    if (sendDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, sendDelayMs));
    }
  }
}

// --- DLQ ---
async function moveToDlq(
  supabase: ReturnType<typeof createClient>,
  queueName: string,
  msg: QueueMessage,
  reason: string
) {
  try {
    await supabase.from("email_dlq").insert({
      queue_name: queueName,
      original_message_id: msg.msg_id,
      message: msg.message,
      reason,
      enqueued_at: msg.enqueued_at,
      read_count: msg.read_ct,
      moved_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Failed to move to DLQ:", err);
  }
}

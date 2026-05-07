import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  secret: string
): Promise<boolean> {
  const parts = sigHeader.split(",");
  const timestamp = parts.find((p) => p.startsWith("t="))?.split("=")[1];
  const signature = parts.find((p) => p.startsWith("v1="))?.split("=")[1];

  if (!timestamp || !signature) return false;

  // Reject stale webhooks (>5 minutes old) to prevent replay attacks
  const tsSeconds = parseInt(timestamp, 10);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - tsSeconds) > 300) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const expectedSig = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return expectedSig === signature;
}

// Helper to send transactional email via Edge Function
async function sendEmail(
  supabase: any,
  templateName: string,
  recipientEmail: string,
  idempotencyKey: string,
  templateData?: Record<string, any>
) {
  try {
    const { error } = await supabase.functions.invoke("send-transactional-email", {
      body: {
        templateName,
        recipientEmail,
        idempotencyKey,
        ...(templateData ? { templateData } : {}),
      },
    });
    if (error) {
      console.error(`Failed to send ${templateName} email:`, error);
    } else {
      console.log(`Queued ${templateName} email to ${recipientEmail}`);
    }
  } catch (err) {
    console.error(`Error sending ${templateName} email:`, err);
  }
}

function formatAmount(amountInCents: number | null | undefined): string {
  if (!amountInCents) return "—";
  return `$${(amountInCents / 100).toFixed(2)}`;
}

function formatPlanName(plan: string): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!STRIPE_WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing configuration");
    return new Response("Server configuration error", { status: 500 });
  }

  const body = await req.text();
  const sigHeader = req.headers.get("stripe-signature");

  if (!sigHeader) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  const isValid = await verifyStripeSignature(body, sigHeader, STRIPE_WEBHOOK_SECRET);
  if (!isValid) {
    console.error("Invalid signature");
    return new Response("Invalid signature", { status: 400 });
  }

  const event = JSON.parse(body);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  console.log("Received event:", event.type);

  // Log every webhook event before processing
  const eventEmail =
    event.data?.object?.customer_email?.toLowerCase()?.trim() ||
    event.data?.object?.customer_details?.email?.toLowerCase()?.trim() ||
    null;

  // Deduplicate: skip if this Stripe event was already processed
  const { data: existingEvent } = await supabase
    .from("webhook_events")
    .select("id")
    .eq("stripe_event_id", event.id)
    .maybeSingle();

  if (existingEvent) {
    return new Response(JSON.stringify({ received: true, duplicate: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  await supabase.from("webhook_events").insert({
    event_type: event.type,
    stripe_event_id: event.id,
    email: eventEmail,
    payload: event,
  });

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const rawEmail = session.customer_email || session.customer_details?.email;
        const email = rawEmail?.toLowerCase()?.trim();
        const customerId = session.customer;
        const subscriptionId = session.subscription;
        const mode = session.mode;

        // ─── Cloud deal payment short-circuit ─────────────────
        // Payment links created by cloud-deal-payment-link include a
        // metadata.deal_id. If present, this is a B2B cloud deployment
        // payment (deposit, final, etc.) — handle separately and bail out
        // before the Cookie Yeti subscription path runs.
        const dealIdMeta = session.metadata?.deal_id as string | undefined;
        if (dealIdMeta) {
          const { data: deal } = await supabase
            .from("cloud_deals")
            .select("id, lead_id, current_stage, deposit_paid_at, company_name, primary_contact_name")
            .eq("id", dealIdMeta)
            .maybeSingle();

          if (!deal) {
            console.error("cloud deal payment but deal not found", dealIdMeta);
            break;
          }

          const updates: Record<string, any> = {};
          if (!deal.deposit_paid_at) updates.deposit_paid_at = new Date().toISOString();
          // Auto-advance to Stage 5 (Tech intake) only if currently <= 4
          if ((deal.current_stage ?? 0) <= 4) updates.current_stage = 5;
          if (customerId && typeof customerId === "string") {
            updates.stripe_customer_id = customerId;
          }

          if (Object.keys(updates).length > 0) {
            const { error: updErr } = await supabase
              .from("cloud_deals")
              .update(updates)
              .eq("id", deal.id);
            if (updErr) {
              console.error("cloud_deal payment update error", updErr);
              break;
            }
          }

          await supabase.from("cloud_deal_events").insert({
            deal_id: deal.id,
            lead_id: deal.lead_id,
            event_type: "deposit_paid",
            event_payload: {
              amount_total: session.amount_total,
              currency: session.currency,
              session_id: session.id,
              payment_intent: session.payment_intent,
            },
            triggered_by: "stripe-webhook",
          });

          // ntfy push to operator
          try {
            const NTFY_BASE = "https://ntfy.sh";
            const NTFY_TOPIC = "bestly-sysalert-7q2k9mx4";
            const ntfyToken = Deno.env.get("NTFY_TOKEN");
            const headers: Record<string, string> = {
              Title: `Deposit paid: ${deal.company_name} ($${((session.amount_total ?? 0) / 100).toFixed(2)})`,
              Tags: "money-bag",
              Priority: "5",
              Click: `https://bestly.tech/admin/cloud/${deal.lead_id}`,
            };
            if (ntfyToken) headers["Authorization"] = `Bearer ${ntfyToken}`;
            await fetch(`${NTFY_BASE}/${NTFY_TOPIC}`, {
              method: "POST",
              headers,
              body: `${deal.primary_contact_name ?? "Client"} just paid the deposit. Auto-advanced to Stage 5: Tech intake.`,
            });
          } catch (ntfyErr) {
            console.error("ntfy push failed (cloud deal)", ntfyErr);
          }

          // Customer-facing receipt + intake invitation
          const { data: dealFull } = await supabase
            .from("cloud_deals")
            .select("primary_contact_email, primary_contact_name, company_name, intake_token")
            .eq("id", deal.id)
            .single();
          if (dealFull?.primary_contact_email) {
            const intakeUrl = dealFull.intake_token
              ? `https://bestly.tech/intake/${dealFull.intake_token}`
              : null;
            const amount = session.amount_total
              ? `$${((session.amount_total as number) / 100).toFixed(2)}`
              : null;
            await sendEmail(
              supabase,
              "cloud-deposit-paid",
              dealFull.primary_contact_email,
              `cloud-deposit-paid-${deal.id}-${event.id}`,
              {
                contact_name: dealFull.primary_contact_name,
                company_name: dealFull.company_name,
                amount,
                intake_url: intakeUrl,
              }
            );
          }

          console.log("Cloud deal payment processed for", deal.id);
          break;
        }
        // ─── End cloud deal handler ───────────────────────────

        if (!email) {
          console.error("No email found in session");
          break;
        }

        // Determine plan from metadata or line items
        let plan = "monthly";
        let status = "active";
        let periodEnd: string | null = null;

        if (mode === "payment") {
          plan = "lifetime";
        } else if (subscriptionId) {
          const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
          if (STRIPE_SECRET_KEY) {
            const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
              headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
            });
            const sub = await subRes.json();
            const priceId = sub.items?.data?.[0]?.price?.id;
            const monthlyPrice = Deno.env.get("STRIPE_PRICE_MONTHLY");
            const yearlyPrice = Deno.env.get("STRIPE_PRICE_YEARLY");
            if (priceId === yearlyPrice) plan = "yearly";
            else if (priceId === monthlyPrice) plan = "monthly";
            periodEnd = sub.current_period_end
              ? new Date(sub.current_period_end * 1000).toISOString()
              : null;
          }
        }

        const { error } = await supabase
          .from("subscriptions")
          .upsert(
            {
              email,
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              plan,
              status,
              current_period_end: periodEnd,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "email" }
          );

        if (error) console.error("Upsert error:", error);
        else console.log("Subscription upserted for", email);

        // Send order confirmation email
        const amountTotal = session.amount_total;
        await sendEmail(supabase, "order-confirmation", email, `order-confirm-${event.id}`, {
          plan: formatPlanName(plan),
          amount: formatAmount(amountTotal),
          orderDate: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
        });

        // Send welcome email
        await sendEmail(supabase, "welcome", email, `welcome-${event.id}`, {
          plan: formatPlanName(plan),
        });

        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const subStatus = subscription.cancel_at_period_end ? "canceled" : subscription.status === "past_due" ? "past_due" : "active";
        const periodEnd = subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : null;

        const { error } = await supabase
          .from("subscriptions")
          .update({
            status: subStatus,
            current_period_end: periodEnd,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_customer_id", customerId);

        if (error) console.error("Update error:", error);
        else console.log("Subscription updated for customer", customerId);

        // Look up email for notification
        const { data: subRecord } = await supabase
          .from("subscriptions")
          .select("email, plan")
          .eq("stripe_customer_id", customerId)
          .maybeSingle();

        if (subRecord?.email) {
          const emailStatus = subStatus === "active" ? "renewed" : subStatus;
          const formattedPeriodEnd = periodEnd
            ? new Date(periodEnd).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
            : undefined;

          await sendEmail(supabase, "subscription-update", subRecord.email, `sub-update-${event.id}`, {
            status: emailStatus,
            plan: formatPlanName(subRecord.plan || "subscription"),
            periodEnd: formattedPeriodEnd,
          });
        }

        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        // Look up email before updating status
        const { data: subRecord } = await supabase
          .from("subscriptions")
          .select("email, plan")
          .eq("stripe_customer_id", customerId)
          .maybeSingle();

        const { error } = await supabase
          .from("subscriptions")
          .update({
            status: "canceled",
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_customer_id", customerId);

        if (error) console.error("Delete error:", error);
        else console.log("Subscription canceled for customer", customerId);

        if (subRecord?.email) {
          await sendEmail(supabase, "subscription-update", subRecord.email, `sub-cancel-${event.id}`, {
            status: "canceled",
            plan: formatPlanName(subRecord.plan || "subscription"),
          });
        }

        break;
      }

      default:
        console.log("Unhandled event type:", event.type);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response("Webhook handler error", { status: 500 });
  }
});

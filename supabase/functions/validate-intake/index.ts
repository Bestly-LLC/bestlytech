import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { intake_id } = await req.json();
    if (!intake_id) {
      return new Response(JSON.stringify({ error: "intake_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: intake, error: intakeError } = await supabase
      .from("seller_intakes")
      .select("*")
      .eq("id", intake_id)
      .single();

    if (intakeError || !intake) {
      return new Response(JSON.stringify({ error: "Intake not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: docs } = await supabase
      .from("intake_documents")
      .select("*")
      .eq("intake_id", intake_id);

    const documents = docs || [];
    const docTypes = new Set(documents.map((d: any) => d.document_type));
    const platforms: string[] = intake.selected_platforms || [intake.platform || "Amazon"];

    const issues: { severity: string; field_name: string; message: string }[] = [];

    // --- Shared Validations ---

    // EIN format
    if (intake.ein) {
      const einClean = intake.ein.replace(/\D/g, "");
      if (einClean.length !== 9) {
        issues.push({ severity: "error", field_name: "ein", message: "EIN must be exactly 9 digits" });
      }
    } else {
      issues.push({ severity: "error", field_name: "ein", message: "EIN is required" });
    }

    // SSN/ITIN — uses 2-letter country codes (US) matching the form
    if (intake.ssn_itin) {
      const ssnClean = intake.ssn_itin.replace(/\D/g, "");
      if (ssnClean.length !== 4 && ssnClean.length !== 9) {
        issues.push({ severity: "warning", field_name: "ssn_itin", message: "SSN/ITIN should be 4 or 9 digits" });
      }
    } else if (intake.citizenship_country === "US" || intake.tax_residency === "US Resident") {
      issues.push({ severity: "warning", field_name: "ssn_itin", message: "SSN/ITIN recommended for US residents" });
    }

    // DOB — must be 18+
    if (intake.date_of_birth) {
      const dob = new Date(intake.date_of_birth);
      const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      if (age < 18) {
        issues.push({ severity: "error", field_name: "date_of_birth", message: "Owner must be at least 18 years old" });
      }
    } else {
      issues.push({ severity: "error", field_name: "date_of_birth", message: "Date of birth is required" });
    }

    // ID expiry
    if (intake.id_expiry_date) {
      const expiry = new Date(intake.id_expiry_date);
      if (expiry < new Date()) {
        issues.push({ severity: "error", field_name: "id_expiry_date", message: "ID has expired" });
      } else {
        const sixMonths = new Date();
        sixMonths.setMonth(sixMonths.getMonth() + 6);
        if (expiry < sixMonths) {
          issues.push({ severity: "warning", field_name: "id_expiry_date", message: "ID expires within 6 months — marketplace may reject" });
        }
      }
    }

    // Phone format
    if (intake.phone_number) {
      const phoneClean = intake.phone_number.replace(/\D/g, "");
      if (phoneClean.length < 10) {
        issues.push({ severity: "warning", field_name: "phone_number", message: "Phone number seems too short" });
      }
    }

    // ZIP codes
    for (const field of ["residential_zip", "registered_agent_zip", "operating_zip"] as const) {
      if (intake[field] && !/^\d{5}(-\d{4})?$/.test(intake[field])) {
        issues.push({ severity: "warning", field_name: field, message: `Invalid ZIP code format` });
      }
    }

    // Routing/account last 4
    if (intake.routing_number_last4 && intake.routing_number_last4.length !== 4) {
      issues.push({ severity: "warning", field_name: "routing_number_last4", message: "Routing number last 4 should be exactly 4 digits" });
    }
    if (intake.account_number_last4 && intake.account_number_last4.length !== 4) {
      issues.push({ severity: "warning", field_name: "account_number_last4", message: "Account number last 4 should be exactly 4 digits" });
    }

    // Required documents (shared)
    if (!docTypes.has("IDFront")) {
      issues.push({ severity: "error", field_name: "documents", message: "Missing ID Front document" });
    }
    if (intake.id_type === "Drivers License" && !docTypes.has("IDBack")) {
      issues.push({ severity: "warning", field_name: "documents", message: "Driver's License back is recommended" });
    }

    // Business name required
    if (!intake.business_legal_name) {
      issues.push({ severity: "error", field_name: "business_legal_name", message: "Business legal name is required" });
    }

    // Contact name required
    if (!intake.contact_first_name || !intake.contact_last_name) {
      issues.push({ severity: "error", field_name: "contact_name", message: "Contact first and last name required" });
    }

    // Agent state vs registration state
    if (intake.registered_agent_state && intake.state_of_registration &&
        intake.registered_agent_state !== intake.state_of_registration) {
      issues.push({ severity: "warning", field_name: "registered_agent_state", message: "Registered agent state differs from state of registration" });
    }

    // Bank info completeness
    if (!intake.bank_name || !intake.account_holder_name || !intake.account_number_last4 || !intake.routing_number_last4) {
      issues.push({ severity: "warning", field_name: "bank_info", message: "Bank information appears incomplete" });
    }

    // Rep authorization
    if (intake.setup_by_representative) {
      if (!intake.rep_name) {
        issues.push({ severity: "error", field_name: "rep_name", message: "Representative name is required" });
      }
      if (!intake.rep_relationship) {
        issues.push({ severity: "error", field_name: "rep_relationship", message: "Representative relationship is required" });
      }
      if (!docTypes.has("RepID")) {
        issues.push({ severity: "warning", field_name: "documents", message: "Missing Representative ID document" });
      }
      if (!docTypes.has("AuthorizationLetter")) {
        issues.push({ severity: "warning", field_name: "documents", message: "Missing Authorization Letter" });
      }
    }

    // --- Amazon-specific ---
    if (platforms.includes("Amazon")) {
      if (!docTypes.has("BusinessRegistration")) {
        issues.push({ severity: "warning", field_name: "documents", message: "Missing Business Registration document (Amazon)" });
      }
      if (!docTypes.has("BusinessAddressProof")) {
        issues.push({ severity: "warning", field_name: "documents", message: "Missing Business Address Proof (Amazon)" });
      }
      if (!docTypes.has("PersonalAddressProof")) {
        issues.push({ severity: "warning", field_name: "documents", message: "Missing Personal Address Proof (Amazon)" });
      }
      if (intake.amazon_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(intake.amazon_email)) {
        issues.push({ severity: "error", field_name: "amazon_email", message: "Invalid Amazon email format" });
      }
      if (!intake.amazon_email) {
        issues.push({ severity: "error", field_name: "amazon_email", message: "Amazon account email is required" });
      }
      if (!intake.amazon_phone) {
        issues.push({ severity: "error", field_name: "amazon_phone", message: "Amazon account phone is required" });
      }
      if (!intake.product_category) {
        issues.push({ severity: "warning", field_name: "product_category", message: "Product category not selected (Amazon)" });
      }
      if (!intake.fulfillment_method) {
        issues.push({ severity: "warning", field_name: "fulfillment_method", message: "Fulfillment method not selected (Amazon)" });
      }
    }

    // --- Shopify-specific ---
    if (platforms.includes("Shopify")) {
      if (!intake.shopify_store_name) {
        issues.push({ severity: "error", field_name: "shopify_store_name", message: "Shopify store name is required" });
      }
      if (!intake.shopify_email) {
        issues.push({ severity: "error", field_name: "shopify_email", message: "Shopify account email is required" });
      }
      if (intake.shopify_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(intake.shopify_email)) {
        issues.push({ severity: "error", field_name: "shopify_email", message: "Invalid Shopify email format" });
      }
    }

    // --- TikTok-specific ---
    if (platforms.includes("TikTok")) {
      if (!intake.tiktok_shop_name) {
        issues.push({ severity: "error", field_name: "tiktok_shop_name", message: "TikTok Shop name is required" });
      }
      if (!intake.tiktok_email) {
        issues.push({ severity: "error", field_name: "tiktok_email", message: "TikTok Shop email is required" });
      }
      if (intake.tiktok_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(intake.tiktok_email)) {
        issues.push({ severity: "error", field_name: "tiktok_email", message: "Invalid TikTok email format" });
      }
      if (!intake.tiktok_phone) {
        issues.push({ severity: "error", field_name: "tiktok_phone", message: "TikTok Shop phone is required" });
      }
      if (!intake.tiktok_category) {
        issues.push({ severity: "warning", field_name: "tiktok_category", message: "TikTok product category not selected" });
      }
    }

    // Clear old validations and insert new ones
    await supabase.from("intake_validations").delete().eq("intake_id", intake_id);

    if (issues.length > 0) {
      await supabase.from("intake_validations").insert(
        issues.map((i) => ({ ...i, intake_id }))
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        errors: issues.filter((i) => i.severity === "error").length,
        warnings: issues.filter((i) => i.severity === "warning").length,
        total: issues.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
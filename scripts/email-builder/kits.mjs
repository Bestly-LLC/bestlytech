// Seed brand kits for the Email Builder. These are DATA that gets written to public.email_brand_kits by
// build-seed.mjs; the renderer (supabase/functions/_shared/email-render.ts) reads them. Edit a kit in the
// database (or here and regenerate), never in the renderer.

const A = "https://www.bestly.tech/email-templates/assets";
const SB = "https://rcqfqhguwpmaarseifqg.supabase.co/storage/v1/object/public/email-assets";

const bestlyAds = {
  heading: "More from Bestly",
  items: [
    { key: "bestly-agent", name: "Bestly Agent", style: "hero", image_url: "https://www.bestly.tech/og-agent.png",
      headline: "Never miss a customer call again.",
      blurb: "Bestly Agent answers your business phone day and night. It books the appointment and texts the confirmation while it talks.",
      url: "https://bestly.tech/agent", cta: "See how it works", extra_text: "or call Maya to try it:", extra_label: "(213) 641-0074", extra_url: "tel:+12136410074" },
    { key: "cookie-yeti", name: "Cookie Yeti", icon_url: `${A}/cookieyeti-icon.png`, icon_bg: "#f3f1ec",
      blurb: "Clicks “Reject” on cookie pop-ups for you, so websites can’t follow you around.", url: "https://bestly.tech/cookie-yeti", cta: "Get Cookie Yeti" },
    { key: "inventoryproof", name: "InventoryProof", icon_url: `${A}/inventoryproof-icon.png`, icon_bg: "#8fb0f0",
      blurb: "Walk through your home with your phone. It lists what you own and what it’s worth, ready for an insurance claim.", url: "https://bestly.tech/inventory-proof", cta: "Get InventoryProof" },
    { key: "bestly-studio", name: "Bestly Studio", icon_url: "https://www.bestly.tech/bestly-mark.png", icon_bg: "#f3f1ec",
      blurb: "We make your social posts. You approve them from your phone. We post them.", url: "https://bestly.tech/studio", cta: "See Bestly Studio" },
  ],
};

const jared = { from_name: "Jared Best", from_email: "jared@bestly.tech", reply_to: "jared@bestly.tech", bcc: "jared@bestly.tech" };

export const KITS = [
  {
    slug: "bestly", name: "Bestly", kind: "house", sort: 10,
    theme: {}, // renderer defaults ARE the Bestly look (indigo #3b4a9c, Newsreader headline, warm paper background)
    header: { layout: "banner", image_url: `${A}/bestly-header.gif`, link_url: "https://bestly.tech", alt: "Bestly", bg: "#0a0a0a" },
    signature: { enabled: true, style: "photo", name: "Jared Best", role: "Founder,", role_brand: "Bestly", email: "jared@bestly.tech", phone: "(816) 500-7236", phone_tel: "+18165007236", image_url: `${A}/jared-headshot.gif`, divider_color: "#7a8be0" },
    footer: { rainbow: true, lines: [
      { text: "Bestly LLC · Gay-owned · Built in Los Angeles" },
      { text: "Bestly builds AI agents and privacy-first apps for small businesses.", link_label: "See what we make", link_url: "https://bestly.tech" },
    ] },
    product_ads: bestlyAds,
    ad_policy: { mode: "auto", max: 2, soft_prefix: "From Bestly:" },
    default_sender: jared,
    assets: {
      headshot: { url: `${A}/jared-headshot.gif`, alt: "Jared Best", label: "Jared's headshot" },
      "bestly-header": { url: `${A}/bestly-header.gif`, alt: "Bestly", label: "Bestly header (animated)" },
      "bestly-agent": { url: "https://www.bestly.tech/og-agent.png", alt: "Bestly Agent: an AI that answers your business phone", label: "Bestly Agent banner" },
      "bestly-mark": { url: "https://www.bestly.tech/bestly-mark.png", alt: "Bestly", label: "Bestly mark" },
      "bestly-og": { url: "https://www.bestly.tech/og-image.png", alt: "Bestly", label: "Bestly share image" },
      "cookie-yeti-icon": { url: `${A}/cookieyeti-icon.png`, alt: "Cookie Yeti", label: "Cookie Yeti app icon" },
      "inventoryproof-icon": { url: `${A}/inventoryproof-icon.png`, alt: "InventoryProof", label: "InventoryProof app icon" },
    },
    ai_images: "allow",
    voice: "Plain, warm and first-person from Jared. Short sentences. Explain things as if the reader has never heard of Bestly. Say what a button does before the button. No hype.",
    default_eyebrow: "A note from Jared",
    site_url: "https://bestly.tech",
  },
  {
    slug: "inventoryproof", name: "InventoryProof", kind: "house", sort: 20,
    theme: {
      page_bg: "#f5f7fa", card_bg: "#ffffff", card_border: "#e1e7ef", text: "#3d4a5c", heading: "#1d2530", muted: "#65758b",
      accent: "#0661d0", accent_text: "#ffffff", eyebrow: "#0661d0", box_bg: "#ebf4fe", rule: "#e1e7ef",
      font_body: "Manrope,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
      font_heading: "Manrope,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
      font_css_url: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&display=swap",
      heading_size: 28, heading_weight: 700, heading_tracking: "-0.02em", radius: 20,
      dark: { page_bg: "#0f1729", card_bg: "#161f30", card_border: "#243049", text: "#c4ccd8", heading: "#f5f7fa", muted: "#97a3b6", eyebrow: "#5aa2f8", box_bg: "#13305a", link: "#5aa2f8", rule: "#243049" },
    },
    header: { layout: "logo", image_url: `${SB}/inventoryproof-icon.png`, link_url: "https://www.inventoryproof.com", alt: "InventoryProof", name: "InventoryProof", name_color: "#0661d0" },
    signature: { enabled: true, style: "text", name: "Jared", role: "InventoryProof Support" },
    footer: { rainbow: false, lines: [
      { text: "Record a video of your home. Get an itemized inventory of everything you own.", link_label: "inventoryproof.com", link_url: "https://www.inventoryproof.com" },
      { text: "Bestly LLC" },
    ] },
    product_ads: { heading: "More from Bestly", items: [] },
    ad_policy: { mode: "never" },
    default_sender: jared,
    assets: {
      "inventoryproof-icon": { url: `${SB}/inventoryproof-icon.png`, alt: "InventoryProof", label: "InventoryProof app icon" },
      "trustpilot-logo": { url: `${SB}/trustpilot-logo-black.png`, alt: "Trustpilot", label: "Trustpilot logo" },
    },
    ai_images: "allow",
    voice: "Calm, clear and reassuring support voice. Short sentences. Say exactly what the account shows. Never blame the customer. Explain what InventoryProof does in one plain sentence if the reader may not know.",
    default_eyebrow: null,
    site_url: "https://www.inventoryproof.com",
  },
  {
    slug: "cookie-yeti", name: "Cookie Yeti", kind: "house", extends: "bestly", sort: 30,
    header: { layout: "logo", image_url: `${A}/cookieyeti-icon.png`, link_url: "https://bestly.tech/cookie-yeti", alt: "Cookie Yeti", name: "Cookie Yeti", name_color: "#3b4a9c" },
    default_eyebrow: "Cookie Yeti", site_url: "https://bestly.tech/cookie-yeti",
    voice: "Friendly and privacy-first. Cookie Yeti clicks Reject on cookie pop-ups so websites can't follow people around. Plain words, no jargon.",
  },
  {
    slug: "hoku", name: "HOKU", kind: "house", extends: "bestly", sort: 40,
    header: { layout: "text", name: "HOKU", link_url: "https://hoku-clean.com", name_color: "#3b4a9c" },
    default_eyebrow: "HOKU", site_url: "https://hoku-clean.com", ad_policy: { mode: "never" },
    footer: { rainbow: false, lines: [{ text: "HOKU", link_label: "hoku-clean.com", link_url: "https://hoku-clean.com" }, { text: "Bestly LLC" }] },
    voice: "Simple and clean, in keeping with a skincare face spray. Short, honest sentences. No medical claims.",
  },
  {
    slug: "bestly-cloud", name: "Bestly Cloud", kind: "house", extends: "bestly", sort: 50,
    header: { layout: "text", name: "Bestly Cloud", link_url: "https://bestly.tech/in-house-cloud", name_color: "#3b4a9c" },
    default_eyebrow: "Bestly Cloud", site_url: "https://bestly.tech/in-house-cloud",
    voice: "Bestly Cloud is a private cloud a business owns, set up and run for them. Plain language, privacy-first, no tech jargon.",
  },
  {
    slug: "bestly-agent", name: "Bestly Agent", kind: "house", extends: "bestly", sort: 60,
    header: { layout: "banner", image_url: "https://www.bestly.tech/og-agent.png", link_url: "https://bestly.tech/agent", alt: "Bestly Agent", bg: "#0b0d14" },
    default_eyebrow: "Bestly Agent", site_url: "https://bestly.tech/agent",
    voice: "Bestly Agent is an AI that answers a business phone day and night, books appointments and texts confirmations. Explain it to someone who has never used AI. Concrete examples, no hype.",
  },
  {
    // Colors, wordmark and fonts are pulled from approval_clients / client_brand by email_kit_build('centering-you')
    // in the seed migration; the object below only carries what that function does not know.
    slug: "centering-you", name: "Centering YOU", kind: "client", extends: "bestly", source_client_slug: "centering-you", sort: 200,
    // Mirrors what email_kit_build('centering-you') derives from client_brand (used by the offline preview and tests;
    // the database copy is the live one).
    theme: {
      page_bg: "#EFE4D6", card_bg: "#ffffff", card_border: "#EFCAB6", text: "#2A6566", heading: "#2A6566", muted: "#52797a",
      accent: "#2A6566", accent_text: "#EFE4D6", eyebrow: "#D44934", box_bg: "#EFE4D6", rule: "#EFCAB6",
      font_body: "'Clear Sans','Helvetica Neue',Helvetica,Arial,sans-serif", font_heading: "Lora,Georgia,'Times New Roman',serif",
      font_css_url: "https://fonts.googleapis.com/css2?family=Lora:wght@400;500&display=swap", heading_weight: 500, heading_size: 30, heading_tracking: "-.01em",
      dark: { page_bg: "#1b2f30", card_bg: "#223c3d", card_border: "#2f4f50", text: "#EFE4D6", heading: "#EFE4D6", muted: "#b9cdc9", eyebrow: "#EF8F55", box_bg: "#2a4647", link: "#F4C459", rule: "#2f4f50" },
    },
    header: { layout: "logo", image_url: "https://rcqfqhguwpmaarseifqg.supabase.co/storage/v1/object/public/review/brand/centering-you/wordmark/centering-you.bebb7a7900.png", link_url: "https://centeringyou.com", alt: "Centering YOU", logo_size: 84, logo_radius: 0 },
    footer: { rainbow: false, lines: [{ text: "Sent with Bestly Studio" }] },
    ad_policy: { mode: "ensure", default_keys: ["bestly-studio"], max: 1 },
    ai_images: "never", // her brand rules list "AI-generated imagery" under things to avoid
    voice: "Warm, direct and calm. Say “I” and “we”. Plain words. Never say “journey” or “affirmation deck”. No emoji.",
    default_eyebrow: "A note from Jared", site_url: "https://centeringyou.com",
  },
];

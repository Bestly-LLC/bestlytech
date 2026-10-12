/**
 * Everything Bestly Agent can connect to, for the "works inside the apps you already use" directory on /agent.
 *
 * Plain text names only. We never reproduce another company's logo. Each group has one plain line saying what she does
 * there. Every connection is built for the customer and takes hours, so the list is a starting point, not a limit.
 * No compliance claims anywhere in this file.
 */

export type IntegrationIcon =
  | "calendar" | "crm" | "helpdesk" | "payments" | "crews" | "health" | "restaurant" | "realestate"
  | "property" | "law" | "auto" | "store" | "phone" | "email" | "files" | "automation";

export type IntegrationCategory = {
  id: string;
  icon: IntegrationIcon;
  title: string;
  /** One plain line: what she does there. */
  does: string;
  names: string[];
};

export const INTEGRATIONS: IntegrationCategory[] = [
  {
    id: "calendars",
    icon: "calendar",
    title: "Calendars and booking",
    does: "Books, moves and cancels appointments in open times only.",
    names: ["Google Calendar", "Outlook and Microsoft 365", "Apple iCloud Calendar", "Calendly", "Cal.com", "Acuity Scheduling", "Square Appointments", "Booksy", "Vagaro", "Mindbody", "Fresha", "SimplyBook.me"],
  },
  {
    id: "crm",
    icon: "crm",
    title: "Customer lists and sales (CRM)",
    does: "Adds new callers, finds returning ones, and writes a note about every call.",
    names: ["HubSpot", "Salesforce", "Pipedrive", "Zoho CRM", "monday.com", "Close", "Copper", "Keap", "GoHighLevel", "Freshsales", "ActiveCampaign", "Airtable"],
  },
  {
    id: "helpdesks",
    icon: "helpdesk",
    title: "Help desks",
    does: "Looks up the order or account and fixes the problem, or opens a ticket for your team.",
    names: ["Zendesk", "Intercom", "Freshdesk", "Help Scout", "Gorgias", "ServiceNow", "Front", "Jira Service Management", "Zoho Desk"],
  },
  {
    id: "payments",
    icon: "payments",
    title: "Payments and invoices",
    does: "Texts a secure payment link, looks up an invoice, and can give a refund up to a limit you set.",
    names: ["Stripe", "Square", "PayPal", "QuickBooks", "Xero", "FreshBooks", "Wave", "Authorize.net", "Chargebee"],
  },
  {
    id: "crews",
    icon: "crews",
    title: "Home services and field crews",
    does: "Creates the job and sends the right person to the right address.",
    names: ["Jobber", "Housecall Pro", "ServiceTitan", "FieldEdge", "Workiz", "Service Fusion", "ServiceM8", "Kickserv"],
  },
  {
    id: "health",
    icon: "health",
    title: "Dental, medical and wellness front desks",
    does: "Books the visit in an open slot and texts the new-patient forms.",
    names: ["Dentrix", "Eaglesoft", "Open Dental", "athenahealth", "DrChrono", "Jane App", "SimplePractice", "Weave"],
  },
  {
    id: "restaurants",
    icon: "restaurant",
    title: "Restaurants and hospitality",
    does: "Finds a table, flags allergies and special occasions, and texts a confirmation.",
    names: ["OpenTable", "Resy", "Tock", "SevenRooms", "Toast", "Clover", "Square for Restaurants", "Yelp Guest Manager"],
  },
  {
    id: "realestate",
    icon: "realestate",
    title: "Real estate",
    does: "Asks the right questions, adds the lead to your list, and books the showing.",
    names: ["Follow Up Boss", "kvCORE", "Lofty", "BoomTown", "Sierra Interactive", "ShowingTime", "Zillow Premier Agent", "dotloop"],
  },
  {
    id: "property",
    icon: "property",
    title: "Property management",
    does: "Takes maintenance requests, answers tenant questions, and books showings.",
    names: ["AppFolio", "Buildium", "Yardi", "Rent Manager", "DoorLoop"],
  },
  {
    id: "law",
    icon: "law",
    title: "Law offices",
    does: "Takes the first call, writes up the details, and books the consultation.",
    names: ["Clio", "MyCase", "PracticePanther", "Smokeball"],
  },
  {
    id: "auto",
    icon: "auto",
    title: "Auto shops",
    does: "Books the repair, checks on a job, and tells the customer when the car is ready.",
    names: ["Tekmetric", "Shopmonkey", "Mitchell 1", "AutoLeap"],
  },
  {
    id: "stores",
    icon: "store",
    title: "Online stores",
    does: "Looks up an order, answers where a package is, and starts a return.",
    names: ["Shopify", "WooCommerce", "BigCommerce", "Squarespace", "Wix", "Etsy", "Amazon Seller Central", "ShipStation"],
  },
  {
    id: "phones",
    icon: "phone",
    title: "Phones and messaging",
    does: "Answers on your own number and follows up by text or WhatsApp.",
    names: ["Your current phone number", "Twilio", "Telnyx", "RingCentral", "Vonage", "Dialpad", "Grasshopper", "Google Voice", "WhatsApp", "Text messages (SMS)"],
  },
  {
    id: "email",
    icon: "email",
    title: "Email and team chat",
    does: "Sends the follow-up email and pings your team the moment a call needs a person.",
    names: ["Gmail", "Outlook", "Slack", "Microsoft Teams", "Mailchimp", "Klaviyo"],
  },
  {
    id: "files",
    icon: "files",
    title: "Files, docs and signatures",
    does: "Saves call notes, fills in your sheets, and sends contracts to sign.",
    names: ["Google Drive", "Google Sheets", "Excel", "Dropbox", "OneDrive", "Notion", "DocuSign", "Bestly Cloud"],
  },
  {
    id: "automation",
    icon: "automation",
    title: "Automations (connects thousands more)",
    does: "Reaches thousands more apps through these tools, or straight through your own API.",
    names: ["Zapier", "Make", "n8n", "Webhooks", "Any app with an API"],
  },
];

/** Entries that are ways to connect or things you already own, not apps, so they stay out of the count. */
const NOT_AN_APP = new Set(["your current phone number", "text messages (sms)", "webhooks", "any app with an api"]);

/** How many different apps are on the list (a name that appears twice counts once). Computed, never typed in. */
export function appCount(list: IntegrationCategory[] = INTEGRATIONS): number {
  const seen = new Set<string>();
  for (const c of list) for (const n of c.names) if (!NOT_AN_APP.has(n.toLowerCase())) seen.add(n.toLowerCase());
  return seen.size;
}

/** "120+": rounded down to the nearest ten, so the number is always true. */
export function appCountLabel(list: IntegrationCategory[] = INTEGRATIONS): string {
  return `${Math.floor(appCount(list) / 10) * 10}+`;
}

/** Lowercase letters and digits only, so "service titan", "ServiceTitan" and "service-titan" all find the same chip. */
export const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export type DirectoryGroup = { category: IntegrationCategory; names: string[]; wholeGroup: boolean };

/**
 * The groups that match a search. A name matches when the typed letters appear in it. A group whose title matches
 * (typing "dental") shows all of its names. Empty search returns everything.
 */
export function searchIntegrations(query: string, list: IntegrationCategory[] = INTEGRATIONS): DirectoryGroup[] {
  const q = squash(query);
  if (!q) return list.map((category) => ({ category, names: category.names, wholeGroup: true }));
  const out: DirectoryGroup[] = [];
  for (const category of list) {
    const titleHit = squash(category.title).includes(q);
    const names = category.names.filter((n) => squash(n).includes(q));
    if (titleHit) out.push({ category, names: category.names, wholeGroup: true });
    else if (names.length) out.push({ category, names, wholeGroup: false });
  }
  return out;
}

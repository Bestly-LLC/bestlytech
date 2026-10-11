# Maya fills the form on screen (fill_contact_form)

Planned with Opus 2026-10-11, built with Sonnet. Jared: "it's weird that she takes us to the contact page but then asks for our contact and then we don't use the contact page to submit."

**Goal:** on the website, the form the visitor sees is the record. Maya types their answers into it live (like she drives the savings calculator), reads it back, and presses Send only after a clear yes. One submission, visible, correctable by typing. No separate sales ticket from the website.

## The tool (already created in ElevenLabs)

`fill_contact_form`, client tool `tool_9601m4pfs50qebrs7gskeetezaw2`, expects_response, 15 s timeout. Params (all optional): `name`, `email`, `phone`, `company`, `team_size` (number), `topic` (a few words), `details` (summary for the team, incl. any tool numbers), `submit` (boolean). Maya attaches it once `maya-watch` lists it in SITE_TOOLS (deployed after this ships, so the site handles it before she can call it).

## Form bridge (same pattern as src/components/cloud/calcBridge.ts)

`src/components/maya/formBridge.ts`: a page registers its form while mounted.

```ts
type FormFieldKey = "name" | "email" | "phone" | "company" | "team_size" | "topic" | "details";
type FormApi = {
  id: "contact" | "cloud-lead";
  fill(v: Partial<Record<FormFieldKey, string | number>>): Promise<{ say: string; missing: string[] }>;
  submit(): Promise<{ ok: boolean; say: string }>;
  read(): { say: string; missing: string[] };
  element(): HTMLElement | null;           // the form card, for the spotlight
};
registerForm(api) -> unregister;  getForm(ms) -> Promise<FormApi | null>;
export const FORM_CHANGED = "maya:form-changed";   // debounced 1.2 s, manual edits only
```

- **Contact.tsx** (`/contact`): maps name→name, email→email, phone→phone (new field), topic→subject, details→message (company and team size are folded into the message as "Company: X · Team size: N" lines when given), category set automatically to `sales` when the visitor is a business asking about a Bestly product or the topic mentions Agent/Cloud/demo, otherwise `general`. Required: name, email, subject, message, category.
- **GetStarted.tsx** (`/get-started`, Bestly Cloud): name→contact_name, email→contact_email, phone→contact_phone, company→company_name, team_size→user_count_band (map the number to the closest band value), topic→primary_pain only if it matches an option (else leave), details→primary_pain_detail. Required = the page's own required fields.
- **Typing**: each new value types into its field (about 25 ms per character, caret visible, the field gets the feathered Maya glow and scrolls into view); Reduce Motion = instant. Never overwrite a field the visitor typed themselves after Maya's last fill unless Maya passes a different value (then replace, and say so in `say`).
- **submit()**: runs the page's real submit path (the same handler as the Send button, via `form.requestSubmit()`), waits for success/error, returns `ok` + a sentence. If required fields are missing, does not submit and returns what is missing. Honeypot untouched.
- Contact form gets `?topic=agent` / `?topic=cloud` support so links (the /agent page's "Get your own agent" CTA) preselect category `sales` and a subject.

## presenter.ts tool `fill_contact_form`

- Picks the form: current path `/get-started` or Bestly Cloud context (`mayaProductForPath` = Bestly Cloud, or topic mentions Cloud) → `/get-started`; otherwise `/contact`. Navigates if needed (same `goTo` as other tools), waits for `getForm(5000)`, spotlights `element()` once on first fill.
- Fills, then returns `say` = which fields are filled (values read back in plain words, emails spelled naturally), which required ones are still missing, and the instruction: "Ask for the missing ones one at a time. When it's complete, read it back and only call again with submit true after a clear yes."
- `submit: true` → `api.submit()`; on success: "Sent. The team gets it right away; tell them when to expect a reply (within 1 business day for sales)". On failure: the error in plain words and offer to try again or call (213) 641-0074.
- `onShow` label: "Filling in your details". MayaScreen listens for `FORM_CHANGED` and sends `sendContextualUpdate` ("The visitor edited the form: ...") so she keeps up.
- `mayaDiag("form-fill", {...})` on any failure.

## Backend

- Migration (append-only): `contact_submissions` gains `phone text`, `source text` (`web` | `maya`), `conversation_id text`. `privacy_data_map` row for `contact_submissions.phone` (match_kind phone, action delete) in the same migration.
- `submit-contact`: accept optional `phone` (max 40), `source`, `conversation_id` (max 80) and category `sales`. When category is `sales`, also file the lead where Maya's desk shows it: insert a `support_tickets` row of kind `sales_lead` exactly like `maya-ticket` does for sales leads (look at that function for the columns, status, due_at and the alert it raises), with the submission's name/email/phone and the message as the issue, so the Sales column on /admin/maya and the hot-lead alert keep working. Website sales leads therefore flow: form → contact_submissions + one sales_lead ticket, never a second ticket from Maya.
- Contact page categories gain "Sales / Book a demo" (`sales`).

## Maya's instructions (maya-watch PRESENTER_BLOCK, deployed after the push)

Close step becomes: "If yes, open the form with fill_contact_form (it picks the right form and opens it). Ask for name, then email, then phone (optional), filling the form after each answer so they watch it fill in. Put a short summary in details (team size, apps, billing, savings number). Read it back; only after a clear yes call fill_contact_form with submit true. On the website never file a sales_lead ticket yourself; the form does it." `open_site_modal book_demo` stays for "just show me the form".

## Watchdog

- `maya-watch` SITE_TOOLS gains the tool id (heals attachment).
- Client failures → `mayaDiag("form-fill")`; maya-watch already counts diag rows? Add: more than 3 `form-fill` diag rows in the last hour → `maya.site` alert ("Visitors' forms aren't filling or sending ...").

## Verify

tsc, build, eslint. Headless: on /contact and /get-started call the registered bridge directly from the page (window hook in dev only, or import via the presenter tool with a fake `onShow`) to fill + submit against a stubbed `supabase.functions.invoke` (route-intercept the submit-contact / submit-cloud-lead request and return 200) so no real lead is created; screenshot mid-typing and after Send.

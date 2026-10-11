/**
 * Bestly Agent demo calls (/agent). Plan: docs/bestly-agent-page-opusplan.md.
 *
 * Each scenario is a short, scripted phone call between Maya (the Bestly Agent, her real voice) and a caller, plus the
 * changes Maya makes in that business's software while she talks. The page plays the recorded call, streams the words
 * into the Maya panel, and replays the events in the mock desktop app window.
 *
 * This file is the contract between the audio pipeline (tools/agent-demo-audio, which records `say ?? text` per line
 * and writes public/agent-demo/<id>.json with real timings) and the page (which renders `text` and fires `events`).
 * Every business, person and phone number here is fictional (555-01xx numbers are reserved for fiction).
 *
 * Events: `at` is how far into the line (0 to 1) the event fires. The app state at any moment is a pure function of
 * the events whose time has passed, so pause, replay and scrubbing all just recompute it.
 */

export type Speaker = "agent" | "caller";
export type AppKind = "helpdesk" | "calendar" | "dispatch" | "crm" | "reservations";

export type DemoEvent = { at: number; do: string } & Record<string, unknown>;

export type DemoLine = {
  who: Speaker;
  /** What the transcript shows. */
  text: string;
  /** What the voice says, only when it must differ from `text` (emails, spelled names). */
  say?: string;
  /** Short chip under Maya's line in the panel: what she did while saying it. */
  tool?: string;
  events?: DemoEvent[];
};

export type Scenario = {
  id: string;
  /** Industry chip label. */
  chip: string;
  /** One line that sets the scene above the Play button. */
  hook: string;
  business: string;
  app: AppKind;
  /** Fictional software name shown in the window title bar. */
  appName: string;
  windowTitle: string;
  /** Clock in the window's menu bar, 12-hour. */
  clock: string;
  caller: { name: string; phone: string; voiceId: string; voiceName: string };
  lines: DemoLine[];
  /** What Maya got done, shown when the call ends. */
  outcome: string[];
};

/** Maya's own voice (her ElevenLabs agent voice). */
export const MAYA_VOICE_ID = "tnSpp4vdxKPjI9w0GnoV";
/** Pause between turns, in seconds. The audio pipeline bakes the same gap into the mp3. */
export const TURN_GAP_S = 0.45;

export const SCENARIOS: Scenario[] = [
  {
    id: "saas-support",
    chip: "Software support",
    hook: "2:14 PM. A customer thinks he was charged twice.",
    business: "Ledgerly",
    app: "helpdesk",
    appName: "Ledgerly Support",
    windowTitle: "Ledgerly Support — Inbox",
    clock: "2:14 PM",
    caller: { name: "Dan Ortiz", phone: "(555) 014-2290", voiceId: "iP95p4xoKVk53GoZ742B", voiceName: "Chris" },
    lines: [
      { who: "agent", text: "Thanks for calling Ledgerly support, this is Maya. Who do I have the pleasure of helping today?",
        events: [{ at: 0, do: "incoming" }] },
      { who: "caller", text: "Hey, it's Dan Ortiz from Ortiz Landscaping. I think you guys charged me twice this month." },
      { who: "agent", text: "Sorry about that, Dan. Let me pull up your account. Okay, I see Ortiz Landscaping on the Pro plan, and you're right: there are two charges of $49 on October 3rd.",
        tool: "Found the account and the duplicate charge",
        events: [
          { at: 0.25, do: "identify", customer: "Dan Ortiz", company: "Ortiz Landscaping", plan: "Pro", seats: "1 of 5" },
          { at: 0.75, do: "flagCharges", amount: "$49.00", date: "Oct 3" },
        ] },
      { who: "caller", text: "Yeah, that's what I saw on my card. Can you fix it?" },
      { who: "agent", text: "Done. I've refunded the extra $49. It'll be back on your card in 3 to 5 business days, and I just emailed you the receipt.",
        tool: "Refunded $49 and emailed the receipt",
        events: [
          { at: 0.1, do: "refund", amount: "$49.00" },
          { at: 0.85, do: "toast", text: "Receipt emailed to Dan" },
        ] },
      { who: "caller", text: "Wow, okay, that was fast. While I have you, can I add my office manager to the account?" },
      { who: "agent", text: "Sure. What's her name and email?" },
      { who: "caller", text: "Priya Shah. priya@ortizlandscaping.com.", say: "Priya Shah. Priya at ortiz landscaping dot com." },
      { who: "agent", text: "Got it: Priya Shah, priya@ortizlandscaping.com. I've sent her an invite. Your plan includes five seats, so there's no extra cost.",
        say: "Got it: Priya Shah, P R I Y A, at ortiz landscaping dot com. I've sent her an invite. Your plan includes five seats, so there's no extra cost.",
        tool: "Invited Priya to the account",
        events: [{ at: 0.55, do: "invite", name: "Priya Shah", email: "priya@ortizlandscaping.com", seats: "2 of 5" }] },
      { who: "caller", text: "Perfect. Thanks, Maya." },
      { who: "agent", text: "Anytime, Dan. I've logged this call on your account. Have a great afternoon.",
        tool: "Wrote the call summary",
        events: [{ at: 0.35, do: "resolve", summary: "Refunded a duplicate $49 charge (Oct 3). Invited Priya Shah as a second seat. Customer happy." }] },
    ],
    outcome: ["Refunded a $49 double charge", "Added a teammate to the account", "Logged the call with a summary"],
  },

  {
    id: "dental",
    chip: "Dental office",
    hook: "6:48 PM. The office is closed. A new patient has a toothache.",
    business: "Brightside Dental",
    app: "calendar",
    appName: "Brightside Schedule",
    windowTitle: "Brightside Schedule — Tomorrow",
    clock: "6:48 PM",
    caller: { name: "Kelly Moran", phone: "(555) 013-7714", voiceId: "cgSgspJ2msm6clMCkdW9", voiceName: "Jessica" },
    lines: [
      { who: "agent", text: "Brightside Dental, this is Maya. How can I help?",
        events: [{ at: 0, do: "incoming" }] },
      { who: "caller", text: "Hi, I've had a toothache since last night, and I'm hoping someone can see me soon. I've never been there before." },
      { who: "agent", text: "I'm sorry you're hurting. We keep time open for emergencies. Dr. Patel can see you tomorrow at 9:30 AM. Would that work?",
        tool: "Checked tomorrow's schedule",
        events: [{ at: 0.55, do: "findSlot", provider: "Dr. Patel", time: "9:30 AM" }] },
      { who: "caller", text: "Yes, please. Do you take Delta Dental?" },
      { who: "agent", text: "We do. Can I get your full name, and is this the best number to text you?",
        tool: "Confirmed insurance is accepted",
        events: [{ at: 0.15, do: "insurance", plan: "Delta Dental" }] },
      { who: "caller", text: "Kelly Moran. And yes, text this number." },
      { who: "agent", text: "You're booked, Kelly: tomorrow at 9:30 AM with Dr. Patel. I just texted you a link to the new-patient forms, so you can skip the clipboard.",
        tool: "Booked the visit and texted the forms",
        events: [
          { at: 0.2, do: "book", patient: "Kelly Moran", reason: "Toothache · New patient", time: "9:30 AM", provider: "Dr. Patel" },
          { at: 0.8, do: "toast", text: "New-patient forms texted to Kelly" },
        ] },
      { who: "caller", text: "That's great. Thank you so much." },
      { who: "agent", text: "Of course. If it gets worse tonight, call back anytime. I'm here all night. Feel better, Kelly.",
        tool: "Added a note for Dr. Patel",
        events: [{ at: 0.4, do: "note", text: "Toothache since last night. New patient, Delta Dental. Forms sent." }] },
    ],
    outcome: ["Answered after hours", "Booked a new patient for 9:30 AM", "Texted the intake forms"],
  },

  {
    id: "plumbing",
    chip: "Home services",
    hook: "9:12 PM. A pipe just burst under a kitchen sink.",
    business: "Ridgeline Plumbing",
    app: "dispatch",
    appName: "Ridgeline Dispatch",
    windowTitle: "Ridgeline Dispatch — Tonight",
    clock: "9:12 PM",
    caller: { name: "Mark Ellis", phone: "(555) 016-3308", voiceId: "nPczCjzI2devNBz1zQrb", voiceName: "Brian" },
    lines: [
      { who: "agent", text: "Ridgeline Plumbing, this is Maya. What's going on?",
        events: [{ at: 0, do: "incoming" }] },
      { who: "caller", text: "Yeah, a pipe under my kitchen sink just burst. There's water everywhere.",
        events: [{ at: 0.6, do: "newJob", title: "Burst pipe · kitchen sink", priority: "Emergency" }] },
      { who: "agent", text: "Okay. First, turn the little valve under the sink clockwise, all the way. Is the water stopping?",
        tool: "Opened an emergency job" },
      { who: "caller", text: "Hang on. Yeah. Yeah, it stopped." },
      { who: "agent", text: "Good. You did the right thing. What's the address?" },
      { who: "caller", text: "1418 Alder Street.",
        events: [{ at: 0.6, do: "address", address: "1418 Alder Street" }] },
      { who: "agent", text: "Thanks. I'm sending Luis, our on-call tech. He's 12 minutes away and will be there by 9:40 PM. The after-hours visit is $149, plus parts and labor.",
        tool: "Sent the on-call tech",
        events: [{ at: 0.25, do: "assign", tech: "Luis", eta: "9:40 PM", fee: "$149 after-hours visit" }] },
      { who: "caller", text: "Fine, just send him." },
      { who: "agent", text: "He's on his way. I texted you his photo and a live tracking link, and I'll text you if anything changes.",
        tool: "Texted the tech's photo and tracking link",
        events: [
          { at: 0.5, do: "toast", text: "Luis's photo and tracking link texted to Mark" },
          { at: 0.9, do: "note", text: "Customer shut off water at the sink valve. Kitchen, under sink." },
        ] },
    ],
    outcome: ["Calmed an emergency and stopped the water", "Dispatched the on-call tech", "Quoted the visit fee up front"],
  },

  {
    id: "real-estate",
    chip: "Real estate",
    hook: "10:05 AM. A buyer calls about a listing while the agent is at a showing.",
    business: "Harbor & Pine Realty",
    app: "crm",
    appName: "Harbor & Pine Leads",
    windowTitle: "Harbor & Pine Leads — Pipeline",
    clock: "10:05 AM",
    caller: { name: "Alex Kim", phone: "(555) 012-4471", voiceId: "bIHbv24MWmeRgasZH58o", voiceName: "Will" },
    lines: [
      { who: "agent", text: "Harbor and Pine Realty, this is Maya. How can I help?",
        events: [{ at: 0, do: "incoming" }] },
      { who: "caller", text: "Hi, I saw the listing for the three-bedroom on Laurel Avenue. Is it still available?" },
      { who: "agent", text: "It is. It's listed at $875,000: three beds, two baths, and a big backyard. Are you working with an agent yet?",
        tool: "Pulled up the Laurel Avenue listing",
        events: [{ at: 0.15, do: "listing", address: "Laurel Avenue", details: "3 bd · 2 ba · big backyard", price: "$875,000" }] },
      { who: "caller", text: "No, not yet. We're pre-approved, though." },
      { who: "agent", text: "Great. Can I get your name, and what price range are you approved for?" },
      { who: "caller", text: "Alex Kim. Up to about nine hundred.",
        events: [{ at: 0.2, do: "lead", name: "Alex Kim" }] },
      { who: "agent", text: "That fits. Sarah, the listing agent, can show it this Saturday at 11:00 AM or 2:00 PM. Which works better?",
        tool: "Qualified the buyer",
        events: [{ at: 0.1, do: "qualify", tags: ["Pre-approved", "Up to $900K", "No agent yet"] }] },
      { who: "caller", text: "Eleven is perfect." },
      { who: "agent", text: "You're set for Saturday at 11:00 AM. I'll text you the address and Sarah's number, and I've told her you're pre-approved, so she'll bring the paperwork.",
        tool: "Booked the showing and alerted Sarah",
        events: [
          { at: 0.15, do: "showing", when: "Sat 11:00 AM", agent: "Sarah" },
          { at: 0.75, do: "toast", text: "Sarah alerted: hot lead, pre-approved" },
        ] },
      { who: "caller", text: "Awesome, thanks." },
      { who: "agent", text: "My pleasure, Alex. Enjoy the tour." },
    ],
    outcome: ["Answered while the agent was busy", "Qualified a pre-approved buyer", "Booked a Saturday showing"],
  },

  {
    id: "restaurant",
    chip: "Restaurant",
    hook: "4:31 PM. The dinner rush is starting and the phone is ringing.",
    business: "Osteria Lume",
    app: "reservations",
    appName: "Lume Reservations",
    windowTitle: "Lume Reservations — Friday",
    clock: "4:31 PM",
    caller: { name: "Dana Reyes", phone: "(555) 015-9026", voiceId: "EXAVITQu4vr4xnSDxMaL", voiceName: "Sarah" },
    lines: [
      { who: "agent", text: "Osteria Lume, this is Maya. How can I help?",
        events: [{ at: 0, do: "incoming" }] },
      { who: "caller", text: "Hi! Can I get a table for six this Friday at 7:30?" },
      { who: "agent", text: "Let me check. 7:30 is full for six, but I can do 6:45, or 8:15 at our big corner table. Would either of those work?",
        tool: "Checked Friday's tables",
        events: [{ at: 0.2, do: "check", time: "7:30 PM", offers: ["6:45 PM", "8:15 PM"] }] },
      { who: "caller", text: "8:15 is good.",
        events: [{ at: 0.5, do: "hold", time: "8:15 PM", table: "Corner table · 6" }] },
      { who: "agent", text: "Perfect. What name should I put it under?" },
      { who: "caller", text: "Dana Reyes. Oh, and one of us has a shellfish allergy.",
        events: [{ at: 0.15, do: "name", name: "Dana Reyes" }] },
      { who: "agent", text: "Noted. I've flagged the shellfish allergy for the kitchen. Is this a special occasion?",
        tool: "Flagged the allergy for the kitchen",
        events: [{ at: 0.25, do: "tag", text: "Shellfish allergy", tone: "warn" }] },
      { who: "caller", text: "It's my mom's birthday, actually." },
      { who: "agent", text: "How fun. I'll let the team know, and dessert's on us. You're booked: Friday at 8:15 PM, party of six, under Dana. I just texted you a confirmation.",
        tool: "Booked the table and texted a confirmation",
        events: [
          { at: 0.2, do: "tag", text: "Birthday · dessert on us", tone: "good" },
          { at: 0.7, do: "confirm" },
          { at: 0.9, do: "toast", text: "Confirmation texted to Dana" },
        ] },
      { who: "caller", text: "Amazing, thank you!" },
      { who: "agent", text: "We'll see you Friday, Dana." },
    ],
    outcome: ["Found a table when the time asked for was full", "Flagged an allergy for the kitchen", "Turned a birthday into a regular"],
  },
];

export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];

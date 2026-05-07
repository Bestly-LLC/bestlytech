# ParentIQ — feature inventory

Internal alignment doc for Eli. ParentIQ is not yet in the bestlytech repo or on the products page; this is the ground-up proposal. Nothing about it has shipped, nothing has been promised externally, and the feature set below is meant to give us a shared starting point to argue with — not a frozen scope.

## One-liner

ParentIQ is a privacy-first AI companion that helps parents make sense of raising their kids — milestones, daily logs, behavioral questions, conflicting advice — on data that never leaves the family.

## The pain we're solving

Every parent we'd build this for has the same week. Their two-year-old wakes up at 2am screaming and won't say why. They pull out their phone in the dark and start Googling "toddler night terror vs nightmare," then "is it normal for a toddler to," then twelve open tabs deep into Reddit threads from 2017 and a Mayo Clinic page that says talk to your pediatrician. The pediatrician is closed. The grandparent who's eight states away has an opinion. The other parent has a different opinion. The internet has fourteen.

The information problem is not lack of information. It's that nothing knows their kid. The Mayo page doesn't know this child has been waking up like this for four nights. The Reddit thread doesn't know the family just moved. The pediatrician's office, when the parent finally gets through, hasn't been told about the new daycare or the milk switch or the cold from last week. Every conversation starts at zero, and a tired parent has to be the database.

The tracking problem is the same shape. Huckleberry tracks sleep. Hatch Baby tracks feedings. The Wonder Weeks app tells them about leaps. BabyCenter sends weekly emails. The school district has its own portal. The pediatrician's MyChart is a separate login. None of these systems can answer "is my kid sleeping less because of the school transition or because of the new sibling or because something's actually wrong" — because no one of them knows about more than one of those things, and all of them are quietly selling slices of the answer to advertisers anyway.

The advice problem is the worst. Parenting advice is contradictory by structure: pediatrics has shifted on co-sleeping, screen time, peanut introduction, and time-outs in the last decade alone. Conservative-leaning parenting books say one thing, gentle-parenting Instagram says the opposite, the grandmother says a third, and the parent has to be the judge. The "is this normal?" question — the most-asked parenting question in the world — has no clean answer because *normal* is a distribution, and no app currently in market gives a parent a real, contextualized read on where their specific child sits in it.

And there's the surveillance problem we have to keep front of mind. The most popular pregnancy and parenting apps have, multiple times, been documented sending location data, advertising IDs, and behavioral data about *babies* to dozens of third parties. This is the most sensitive PII a person ever generates about another person, and it's been treated like ad inventory. That's the gap in the market we should walk through.

## Who it's for

**Primary persona — first kid, 0–3.** A parent (or two) of one young child, navigating maximum information overwhelm and near-zero confidence. They're already running three or four tracking apps, asking ChatGPT questions they'd be embarrassed to ask in person, and have a dozen unread newsletters. They have iPhones, decent internet, household income that supports a $5–15/mo subscription, and have at least once typed their child's symptoms into a search engine at 2am. This is the wedge.

**Secondary — parents of multiple kids.** Different problem shape. They're not learning *what's normal*; they're managing comparative tracking ("the older one started talking by now, should I be worried?"), shared logistics across siblings, and the cognitive load of remembering which kid had which shot when. The product needs to handle multiple child profiles without feeling like SAP.

**Secondary — parents of older kids (4–12).** Less sleep tracking, more "is this behavior age-appropriate," school transitions, friendship dynamics, screen-time rules, the start of medical history that matters long-term. Different feature emphasis (less logging, more journaled-context-and-AI).

**Secondary — co-parents and split households.** Shared visibility across a couple, or across two households after a separation. This is a common, underserved case — most apps assume one parent owns the account.

**Out of scope for v1.** Daycare staff, nannies, pediatricians, schools. Eventually they're invitable read-only collaborators; not at launch.

## Core features

**Development & milestones**

- *Milestone tracker.* Per-child timeline of motor, cognitive, social, language, and self-care milestones, anchored to the standard (CDC + AAP) ranges, but presented as bands, not deadlines. Parents log when something happens; the AI confirms or asks a clarifying question.
- *Range-not-deadline display.* Every milestone shows a percentile band ("most kids do this between 9–14 months") instead of a single age, to push back on the comparison anxiety that drives downloads of competitor apps but doesn't help anyone.
- *Personalized leaps & growth notes.* Weekly or bi-weekly summary, generated for *this kid*, of what's developmentally likely to be happening — replacing the generic "Wonder Week 26 is starting" newsletter with something grounded in the child's actual logged history.
- *Photo-anchored memory book.* Optional per-milestone photo capture that builds a private timeline. Not a social product; an artifact for the family. Exportable.

**Daily tracking**

- *Sleep log.* Naps, night sleep, wake-ups, total. Apple Watch / sleep-monitor import where the parent already has one; otherwise a one-tap log that's faster than Huckleberry.
- *Feeding log.* Breast, bottle, solids, allergies-introduced. Lightweight enough that one parent can capture it during a 3am feed without waking up.
- *Diaper / potty log.* For the first few years, then automatically retired.
- *Symptom & illness log.* Fevers, coughs, rashes, what was given when. Becomes a clean handoff document at the next pediatrician visit.
- *Mood & behavior log.* Free-text or a quick-tap chooser. The lowest-friction one wins; we should ship both and watch.
- *Voice capture.* "Hey, just logging that she had two bites of broccoli at dinner." Speech-to-text that the AI parses into the right structured log without a form.

**The AI companion**

- *Chat that knows your kid.* Context-aware Q&A that has read the child's logs, milestones, and history. "Why might Maya be waking up more this week?" produces a real attempt at an answer, not a Wikipedia paste.
- *Source-cited reasoning.* When the AI claims something developmental ("most kids her age are doing X"), it cites where — AAP, NIH, a specific peer-reviewed study, a named pediatrician's published guidance. Parents see receipts.
- *Conflicting-advice synthesizer.* Parents paste in two or three pieces of contradictory advice (or take a photo of the parenting book page) and the AI lays out where they disagree, what the evidence base looks like for each, and what's specific to *their* kid's situation. This is one of the strongest single use-cases in the product.
- *"Is this normal?" check.* A first-class flow, not buried in chat. Parent describes what they're seeing, AI responds with: probably-normal-and-here's-why / worth-watching-with-these-signals / call-the-pediatrician-now. Always errs toward "ask a doctor" in ambiguous cases. This is the load-bearing safety stance.
- *Daily debrief.* Optional. End of day, parent has 90 seconds; the AI produces "here's what today looked like" and surfaces anything worth flagging.

**Family & sharing**

- *Co-parent sync.* Two adults, one shared profile per child, real-time visibility across both phones.
- *Split-household mode.* Two households, two adults each, granular control over what each side sees. Designed-in, not bolted on after.
- *Trusted-circle invites.* Read-only invites for grandparents or a nanny, scoped per-child, revocable in one tap. No data extraction, no ads, no tracking pixels in their view either.
- *Multi-child support.* Profiles per child, switching as fast as iMessage threads. AI's context is per-child by default, with explicit "compare across kids" only when the parent asks.

**Healthcare & continuity**

- *Pediatrician visit prep.* One tap before an appointment generates a one-page brief: recent logs, current concerns, questions the parent had this week, vitals trend. Parent can hand the phone over or send as PDF.
- *Vaccine & visit history.* Parent enters or imports; the AI tracks the schedule and gently flags what's coming up.
- *Apple Health import.* Where the parent already has Apple Health populated, import height/weight/sleep/heart-rate without re-entry. Read-only; we don't write back.

**Privacy & controls**

- *Data dashboard.* Parent can see, in plain language, every category of data we hold about each child, when it was collected, and which of it the AI has read. Not a settings page — a primary surface.
- *One-tap export.* Full child-history export as JSON, PDF, or printable timeline. Bestly never holds the data hostage.
- *One-tap delete.* Child profile deletion with cryptographic destruction of the encrypted blob. We say so, and we publish how.
- *AI memory audit.* The parent can read the actual durable memory the AI has formed about their kid (in plain English, not embeddings) and edit or wipe it. This is the feature that competitors structurally cannot ship.

That's 24 features across six categories. Some will collapse during MVP scoping; some will surface sub-features we haven't named yet.

## The AI layer

The AI does three jobs: answer questions in chat, synthesize background notes (weekly summaries, visit prep, daily debriefs), and parse voice/text logs into structured data. Three jobs, two model tiers.

**On-device tier.** Voice transcription (whisper-cpp class), log parsing, and the privacy-sensitive "what's in this photo" / "what's in this paste" pre-filter all run on-device. The parent's phone is doing the work; nothing leaves it. This is also where the always-listening "log this" voice capture lives, because anything else is a non-starter.

**Cloud tier.** The chat companion and the longer reasoning passes (visit-prep generation, conflicting-advice synthesis) need a frontier model. We'd likely route to Claude for the reasoning-heavy paths, with the option to fall back to a hosted open-weight model for cost-sensitive tiers later. The cloud calls go through a Bestly-controlled proxy — we never call the model vendor directly from the device — so we control logging, retention, and what gets sent.

**What the cloud model is allowed to see.** Only the data needed for the current question, scoped per-call. The model sees the child's logs and history if the parent is asking a question that requires them; it does not see "all of ParentIQ's user base" or any aggregate. We do not train on customer data. We negotiate that into our model contracts and we say so on the marketing site.

**What it never sees.** Photos by default (those are on-device only and only included if the parent explicitly attaches one to a message). Names, addresses, school names, pediatrician names — pseudonymized at the proxy boundary unless the parent has explicitly granted that this conversation needs them.

**Audit, not just promises.** The AI memory audit feature above isn't decorative — it's the user-facing implementation of this stance. The parent can read what the AI durably knows. They can wipe specific facts. They can wipe everything. The audit log of every cloud call, with redacted payload summaries, is available on request.

**Hard limits we should agree on now.** ParentIQ does not give medical diagnoses. It does not replace a pediatrician. It pushes toward "talk to a doctor" in ambiguous cases by default — and we should tune the bias hard in that direction, even at the cost of the product feeling occasionally over-cautious. Worst-case outcome for ParentIQ is a missed real medical issue, and that has to drive a lot of the product's safety design.

## Privacy stance

What's collected: only what the parent enters or imports. Logs, milestones, photos they explicitly attach, and the optional integrations they enable (Apple Health). Nothing more.

What isn't: ad identifiers, location, contacts, browsing data, third-party SDK telemetry of any kind. We don't ship a single advertising or analytics SDK in the app. App Store privacy labels read like a blank page on purpose.

Where it lives: encrypted at rest with per-family keys, on infrastructure we control. Long-term, this is a candidate for an In-House Cloud-style on-premises deployment for institutional buyers (school networks, pediatric practices) — the same private-cloud model from our flagship program, applied to a consumer product's institutional tier.

Who can see it: the family. The trusted-circle people they explicitly invite, with the scope they explicitly granted. Bestly support staff cannot read child data without an active, time-limited grant from the parent to a specific issue. Nobody else. Not advertisers, not researchers, not law enforcement without a valid warrant — and we publish a transparency report.

How this is different from BabyCenter / The Bump / Huckleberry / Wonder Weeks: those products are mostly ad-funded or VC-funded, and many have been documented (FTC complaints, academic studies) sending data about pregnancies and infants to ad networks and data brokers. Some of the trackers and forums are useful; the data model underneath is hostile. ParentIQ is paid by parents directly so we don't have to be hostile.

## Differentiators

1. **Zero data sale, structurally.** Not a privacy-policy clause — a business-model commitment. Subscriber-funded, no ad SDKs, no broker contracts. The competition can't match this without burning their revenue model down.
2. **AI that knows *this* kid.** BabyCenter's content is the same content for everyone. Wonder Weeks is the same calendar for everyone. ParentIQ's answers are grounded in the specific child's logged history, which is also the moat — switching cost rises with every entry.
3. **One product instead of seven.** A parent today is running a sleep tracker, a feed tracker, a milestone tracker, a baby-book photo app, a co-parenting calendar, a content app, and ChatGPT. We collapse all of that into one place that the AI can actually reason across.
4. **Citations and humility.** We show our work. When the AI claims something is normal, it says where it got that. When the AI doesn't know, it says so. This is rarer than it should be.
5. **Auditable AI memory.** No competitor lets a parent read what the AI knows about their kid, in English, and edit it. We will.
6. **Bestly's bones.** Same trust principles, same on-prem philosophy at the institutional tier, same plain-spoken brand voice. The brand alone differentiates us from VC-funded baby-data unicorns, and our existing audience already self-selects for caring about this.

## MVP cut

Three months, opinionated. The bar is: a real first-time parent can use ParentIQ as their daily app and feel a measurable difference vs. Huckleberry plus ChatGPT.

**In:**
- One child profile per account.
- Sleep log, feeding log, diaper log, symptom log, free-text mood/notes log. One-tap entries; voice capture on day one (this is what makes us not-a-form).
- Milestone tracker with bands-not-deadlines display.
- AI chat that has read the child's logs and history. Cloud Claude integration, redacting proxy, no training-on-data.
- "Is this normal?" check as a first-class entry point.
- Pediatrician visit-prep PDF generator.
- Data dashboard, full export, full delete, AI memory audit. All four privacy-stance features ship at v1 — they're load-bearing for positioning.
- iOS only. Native, not React Native. We have the bandwidth and Apple-native quality is part of the brand.

**Out (ship in v1.1–v1.3):**
- Co-parent sync. Single-account at v1; two-account same-household next.
- Split-household mode. Hard, designed-in for v1.2.
- Multi-child support. v1.1.
- Trusted-circle invites. v1.2.
- Apple Health import. v1.1.
- Photo memory book. v1.1.
- Android. After iOS v1.2 ships and we know the product works.
- Conflicting-advice synthesizer as a dedicated flow. The general chat handles it adequately at v1.

The omissions are real opinions, not punts. Single-child + iOS + native is the cheapest way to ship something that feels like a Bestly product. Co-parenting and multi-child are well-defined enough to add cleanly later.

## Pricing model hypothesis

Two candidates worth running.

**Option A — Family subscription, $9.99/mo or $79/yr.** All features included, all children, all co-parents on a household. Free 14-day trial; no free tier. This is the clean privacy-first stance — we're paid by the parent so we work for the parent, full stop. Comparable to Headspace or Calm pricing, which is roughly the right anchor since this lives in the same monthly-mental-load category. Strong recommendation for v1.

**Option B — Freemium with a real free tier.** Free: logging, milestone tracking, weekly summary, one AI chat per day. Paid ($7.99/mo): unlimited AI chat, visit-prep, conflicting-advice flows, multi-child, co-parent sync. Lower friction to first install; the freemium tier doubles as marketing. Risk: free tier users will still cost us cloud-AI inference, and the privacy-first messaging gets muddier when the math depends on conversion.

I'd ship A. It's cleaner, it's on-brand for Bestly, and the buyer who is right for this product won't blink at $79/yr if the alternative is feeding their kid's data to BabyCenter. We can revisit a free tier in v2 if conversion data demands it.

Not recommended: one-time purchase. The cloud-AI cost is recurring; the pricing has to match it.

## Open questions

1. **Pediatric authority strategy.** Do we get a real pediatric advisor on retainer to vet the AI's guardrails, the "call your doctor" thresholds, and the milestone-band sourcing? Strongly recommend yes before any beta with real parents. Cost and identity TBD.
2. **Liability surface.** What's our exposure when the AI says "probably normal" and a kid turns out to have something serious? We need real legal review on disclaimers, terms, and incident response before v1 is public. This is the single biggest non-product question.
3. **iOS vs. cross-platform.** I argued iOS-only above, but if Eli's read on the audience is heavily Android-skewed, that flips. Worth a real call this week.
4. **Pricing sensitivity.** $9.99/mo is a guess. We should pre-test with five real parents in the target persona before we commit on the marketing site.
5. **AI vendor lock-in.** Default to Claude is right today. But if Anthropic's pricing or terms change, can we route to a hosted open-weight model in 4 weeks without breaking the product? Architectural call to make at design time, not after launch.
6. **Healthcare data integrations.** Do we attempt FHIR / pediatric EHR integrations in year one, or stay out of regulated healthcare territory entirely? Apple Health import is the soft path; direct EHR is the hard one. HIPAA implications differ wildly between the two.
7. **Brand fit.** ParentIQ as a name is a working title. "IQ" risks sounding ad-tech-adjacent and slightly clinical. Alternatives worth a look: a softer, more parent-toned name. Worth a 30-minute pass with the brand voice in hand.
8. **Distribution.** Do we ship this as a standalone Bestly product (parentiq.com / link from bestly.tech), as a Bestly app on the products page, or both? The brand reads better as Bestly-everything; the SEO and App Store math may say otherwise.

# HOAscope — feature inventory

Internal alignment doc. For Eli. Written 2026-05-04.

Note on naming: the marketing config still lists this product as "HOA Cure." We're calling it HOAscope going forward — the rename hasn't propagated yet. Same product, same thesis.

## One-liner

HOAscope is the privacy-first operating system for self-managed HOAs and the small property managers who serve them — violations, dues, communications, board ops, and resident self-service in one place, with state-law compliance built in instead of bolted on.

## The HOA pain

HOAs are the worst-run multi-million-dollar entities in America. About 75 million people live in one. Most are governed by three to five volunteers — often retirees, sometimes lawyers, occasionally a single furious homeowner who ran for the board after a parking dispute — collecting six- or seven-figure annual budgets and enforcing CC&Rs written in 1987. The software they run on is a museum: FrontSteps, TownSq, AppFolio, Buildium, HOA Express, an Excel sheet a treasurer maintains, a Gmail account shared by three rotating board members, a Dropbox folder nobody can find, and paper. The tools that exist were built for the property-manager-as-buyer, which means the daily operator is happy enough and everyone else — board, residents, vendors — gets a portal that looks like it was designed in 2009 and acts like it.

The pain is layered.

**Vendor sprawl.** A typical 200-unit HOA runs accounting in one tool, violations in another, communications in a third, the website in a fourth, and the resident portal as a fifth login that nobody's resident actually uses. Five vendors, five passwords, five places to look when something goes wrong, five renewal cycles.

**Hostile board-vs-resident dynamics.** The board is a quasi-government with the power to fine, lien, and in some states foreclose. The resident is a property owner who often had no idea the HOA existed when they bought the house. CC&R enforcement feels capricious because it usually is — selective, inconsistent, sometimes retaliatory. Existing software amplifies the asymmetry: the board sees everything, the resident sees a balance and a violation letter. Trust is structurally low.

**Volunteer burnout.** Board members are unpaid. Terms are typically two or three years. Turnover is brutal. Institutional knowledge — which vendor handles the pool, which neighbor's been complaining about which fence for a decade, where the reserve study lives — walks out the door at every election. Onboarding the next board takes months.

**Resident information asymmetry.** A homeowner trying to find out what their CC&Rs say about their roof color, what they owe, when the next meeting is, or why they got fined typically has to email the board, wait, and hope. Forty percent of resident-board conflict could be eliminated by giving the resident a working search bar.

**State-law compliance maze.** California's Davis-Stirling Act runs to thousands of words of detailed procedure — open meeting requirements, notice periods, election rules, reserve study cadence, internal dispute resolution. Florida Chapter 720 is different. Arizona Title 33 Chapter 9 is different again. Texas, North Carolina, Colorado, Nevada — each their own statute, each amended every legislative session, each enforced by a state agency or attorney general with real teeth. A board that misses a 30-day notice can have an entire enforcement action voided. Most HOAs are out of compliance and don't know it.

**The reserve and disclosure problem.** Reserve studies, financial disclosures, year-end reports, transparency filings — required, often missed, never trivial to produce. Post-Surfside, every state is tightening structural reserve requirements. The next decade is going to be a compliance bloodbath for under-funded associations, and the software they're running on doesn't help them get ahead of it.

## Who it's for

There are three real personas. We pick our buyer carefully.

**Primary persona — the self-managed HOA board (volunteer-run, 30 to 250 units).** The unloved middle. Too small to justify a property management company, too big to run on a shared inbox. This segment is where the pain is sharpest and where the incumbents are weakest, because the incumbents are sold to professional property managers as a productivity tool, not to volunteer boards as a survival tool. The buyer is the board treasurer or president. The decision cycle is short — one meeting, one vote, one card swipe. They will pay if we save them their weekends.

**Secondary — the small property manager (1 to 20 associations under management).** The independent operator who manages a handful of HOAs and doesn't want to pay AppFolio rates. We can serve them with a multi-association mode and become their daily driver. Useful as a wedge but they're not who we design the core product around.

**Tertiary — the resident.** Not the buyer, but the persona we have to delight or the whole thesis collapses. Resident adoption is what justifies the board's purchase: if the resident self-service piece works, the board's email volume drops 60 percent and they renew forever. We design the resident experience as if they were paying us.

**Position: the buyer is the board, and we win residents by being the first HOA software residents don't actively hate.** Property managers are an adjacent market we earn into, not the spear point. Going after property managers first puts us in a feature war with FrontSteps and AppFolio that we can't win in year one and don't want to win in year three. Going after self-managed boards puts us in a category that nobody is seriously serving with a modern product.

## Core features

Six buckets, twenty-six features. Sized for a real product, not a pitch deck.

### Violations and enforcement

The single most painful workflow in HOA-land. Where most resident-board conflict originates and where most existing software is at its worst.

1. **Violation intake** — a board member, a property manager, or a resident can submit a violation from a phone in under 30 seconds. Photo, location pin, CC&R clause auto-suggested from a categorized list.
2. **Photo evidence locker** — every violation gets a timestamped, geotagged evidence chain. Photos are stored in a way that survives a courtroom challenge.
3. **Auto-generated notice letters** — state-specific templates for first notice, fine notice, hearing notice, cure-period extensions. The board never writes a letter from scratch again.
4. **Hearing scheduler** — built-in scheduling for in-person or video hearings, with the right notice period for the state. Davis-Stirling requires ten days; Florida is fourteen for some matters; the system knows which.
5. **Appeal workflow** — resident-initiated, board-resolved, audit-logged. Resolution status visible to the resident at every step.
6. **Cure tracking** — was the fence repainted? Is the trash can put away? A photo from the reporter, a date, a one-tap close.
7. **Repeat offender heat map** — internal-only. Surfaces the addresses that drive 80 percent of enforcement work, so the board can decide whether they have a property problem or a neighbor problem.

### Dues and assessments

Money is the other place existing software falls down — most boards still take checks because their billing tool charges 3.5 percent and the PDF receipt is illegible.

8. **Recurring dues billing** — monthly, quarterly, annually. Per-unit, per-square-foot, or tier-based.
9. **ACH and card collection** — ACH at near-zero, card with transparent surcharge passed to resident. No hidden processor markup.
10. **Late fees and lien progression** — automated grace periods, late notices, intent-to-lien, all on a state-specific calendar. The board approves the action; the system handles the timing.
11. **Special assessments** — board-initiated, vote-tracked, billed proportionally with documented apportionment.
12. **Payment plans** — boards can offer structured payment arrangements without leaving the system.
13. **Year-end statements** — every resident gets a complete payment history PDF, on demand, without anyone touching it.

### Communications

14. **Community announcements** — segmented by unit type, building, owner-vs-tenant, opt-in lists. Email plus SMS, with delivery receipts.
15. **Emergency broadcast** — pool closure, water shutoff, evacuation. SMS-first, sub-60-second delivery, geofenced if needed.
16. **Resident polls and votes** — non-binding straw polls and binding member votes, with state-compliant ballot procedures where required.
17. **Board-resident messaging** — threaded, board-attributed (a message comes "from the board," not from a personal Gmail), archived as part of the official record.
18. **Newsletter** — scheduled, templated, no MailChimp account required.

### Board operations

19. **Meeting agenda builder** — open-meeting requirements vary by state; the agenda template enforces them. Notice goes out with the right lead time automatically.
20. **Minutes capture and votes** — record motions, seconds, votes, attendance. Generates the official minutes record and stores it in the document library.
21. **Document library** — bylaws, CC&Rs, reserve studies, contracts, insurance certificates. Searchable. Versioned. Permission-scoped (board-only vs. member-accessible).
22. **Board term tracking** — when does each director's term end? When are elections required? Auto-reminders for nominating committees.
23. **Vendor and contract registry** — pool service, landscaping, insurance, legal. Renewal dates, contact info, performance notes.

### Resident self-service

24. **CC&R search** — a working search bar over the bylaws and CC&Rs. AI-assisted ("can I paint my door black?") with citations to the actual clause. This alone justifies the product to residents.
25. **Payment portal** — see what you owe, pay it, see the history. Dark mode. Works on a phone.
26. **Architectural Control Committee (ACC) requests** — submit a modification request, attach plans, track approval status. Most-photographed, least-understood workflow in HOA-land — there is no good software for it.
27. **Service requests** — broken streetlight, sprinkler issue, common-area concern. Routed to the right vendor or board committee.

### Compliance and transparency

28. **Reserve study integration** — link the current reserve study, surface funding-percent-of-fully-funded on the board dashboard, alert when next study is due.
29. **State-required disclosures** — auto-prepared annual budget summary, pro-forma operating budget, reserve summary, insurance summary in the format the state requires.
30. **Audit log** — every board action is timestamped, attributed, and exportable. Defensible record-keeping by default.

That's thirty if we're being honest, but several collapse in the MVP.

## Differentiators

**Versus FrontSteps and TownSq.** They're built for the property manager. We're built for the board and the resident. They charge per door per month with hidden payment processor markups; we publish pricing. Their UX is 2009; ours isn't.

**Versus AppFolio and Buildium.** They're property-management platforms with HOA bolted on. The HOA module is an afterthought. We are HOA-native, which means the workflows match how a board actually operates rather than how a multi-family landlord operates.

**Versus HOA Express.** It's a website builder with bills attached. We're an operating system. Not the same product even when the marketing copy overlaps.

**Versus paper, spreadsheets, and shared Gmail.** This is the actual incumbent. Eighty percent of small HOAs run on it. The differentiation isn't features — it's that the board gets six hours a month back, the resident finally has a search bar, and the next board doesn't start from zero.

**Versus all of them: privacy and ownership.** Resident financial history, violation records, board deliberations — this is sensitive data. Existing tools sell to the property-manager buyer and treat resident data as a feature lake. Bestly's stance — collect less, never sell, export anytime — is a meaningful wedge in a category that has never seen one.

## Privacy stance

HOAs sit on weirdly sensitive data. A violation file is, in plain English, a record of a neighbor reporting on a neighbor. A dues ledger is a list of every household in the community that's behind on bills. Board executive sessions discuss legal exposure, employment matters, and pending litigation. None of this should be aggregable, sellable, or sharable beyond the people who absolutely need it.

What Bestly's privacy stance means in HOAscope:

- **Data minimization.** We don't ask for SSNs. We don't ask for spouse income. We don't ask for anything not required by the operating workflow or by state law.
- **Role-scoped access.** A board member sees the board view. A committee chair sees their committee. A resident sees their record. A property manager sees their portfolio. Cross-association data does not cross.
- **Executive-session protection.** Board deliberations marked executive are encrypted at rest with a board-controlled key, separable from regular records, retained on a board-set schedule.
- **No data sale, ever.** No analytics resale, no benchmarking products built on customer data without explicit per-association consent.
- **Export and portability.** Every association can export everything in open formats. We don't lock anyone in.
- **In-House Cloud option.** For HOAs that want their data physically on a server in the management office or the clubhouse, we offer the same In-House Cloud architecture we sell to companies. This is a differentiator no SaaS competitor can match, and a few large self-managed associations will care intensely.

## Compliance footprint

Compliance is the moat. It's also the thing that keeps you up at night. Don't be comprehensive on day one — be deeply correct in two states and add the rest deliberately.

**Day-one states: California (Davis-Stirling) and Florida (Chapter 720).** Together these are roughly 35 percent of US HOA units and the two most procedurally exacting state regimes. If we get these two right, the underlying engine — notice periods, meeting requirements, election procedures, reserve study cadence, financial disclosures — generalizes.

**Phase 2 (months 6–12): Arizona (Title 33 Ch 9), Texas (Property Code Ch 209), North Carolina (Ch 47F).** High HOA density, distinct enough from CA/FL to validate the abstraction.

**Phase 3 (year 2): Colorado, Nevada, Washington, Virginia, Illinois.** Round out the top markets.

**Federal layer, always on:** Fair Debt Collection Practices Act for dues collection, Fair Housing Act for enforcement consistency, FinCEN Beneficial Ownership filings for the association entity, ADA compliance for the resident portal, accessibility of community communications.

**The compliance product:** every state ships with a "compliance check" surface — a board dashboard that says "here are the seven things your association is required to do this year, here's your status on each." That's the upsell. That's also the trust signal.

## MVP cut

Don't go wide. Pick the one workflow that hurts most and solve it so well that boards switch for that alone.

**MVP — months 1 to 4. One pain point: dues and the resident payment portal.**

- Recurring dues billing
- ACH and card collection with transparent fees
- Resident payment portal (see balance, pay, see history)
- Year-end statements
- Late fee automation (basic, not lien-progression yet)
- Document library (read-only, board-uploaded)
- Community announcements (email only at MVP, SMS in v1.1)
- Audit log (always on)

That's it. Eight features. One state at full compliance fidelity (California, because Davis-Stirling is the hardest test and the LA market is on our doorstep). One persona served end-to-end (the board treasurer of a self-managed HOA between 30 and 150 units).

Why dues first, not violations. Dues are the boring workflow that drives renewal. A board that successfully collects six months of dues through HOAscope cannot go back to checks. Violations are sexier and more differentiated, but they're an emotional purchase — boards talk themselves into and out of buying violation software all the time. Dues are an operational purchase. Land on dues, expand into violations in v1.1.

**v1.1 — months 5 to 8.** Violations end-to-end (intake, evidence, notices, hearings, appeals), board meeting tools, ACC requests, CC&R search, SMS communications, second state (Florida).

**v1.2 — months 9 to 12.** Multi-association mode for small property managers, reserve study integration, compliance dashboard, three more states.

## Pricing model hypothesis

Two candidates. We pick one to test.

**Option A — flat fee per association, tiered by unit count.** $99/month for 1–50 units, $249 for 51–150, $499 for 151–500, custom above. Residents free. Property managers pay the same per-association fee for each association they manage.

Pro: predictable, easy to sell to a treasurer in a single board meeting, no per-resident math, residents will use the resident features without a per-seat tax that disincentivizes adoption (and resident adoption is the moat).

Con: leaves money on the table for very dense associations.

**Option B — per-door per-month, no resident fee.** $1.50 to $3.00 per unit per month, tiered by feature pack. Matches industry pricing convention.

Pro: scales with value. Property managers are already comfortable with per-door pricing.

Con: per-door pricing is exactly how the incumbents price. We lose a differentiator. And board-buyers reading their first contract have to do mental math, which is the wrong feeling at the moment of purchase.

**Recommendation: Option A.** Flat-fee-per-association pricing is friendlier to volunteer boards, matches the Bestly tonal stance ("plain-spoken, no surprises"), and beats the incumbents on simplicity. Publish a pricing calculator on the marketing site — most competitors hide pricing, which is itself a tell.

A possible third path worth flagging: freemium for the board (announcements, document library, meeting tools — free), paid for residents-and-money features (dues, violations, ACC). I'm skeptical. HOAs aren't going to pay residents to use software, and most resident-side value compounds with the board-side data. But it's worth one round of customer conversations before we lock pricing.

## Open questions

1. **Buyer hypothesis test.** Is the self-managed board really the buyer, or do we get pulled into the property-manager market against our will because that's where the money is? Five customer conversations in the next thirty days will tell us.
2. **Reserve study partnership or build.** Reserve studies are produced by specialized firms (Reserve Advisors, Association Reserves, etc.). Do we integrate with their output formats, or do we eventually offer a reserve study product? The latter is a bigger market but a bigger bite.
3. **State expansion economics.** Each new state is real legal review, real template work, real ongoing maintenance. What's the per-state cost and the per-state break-even unit count? Until we know this we can't price confidently.
4. **AI for CC&R search.** The "can I paint my door black?" search is probably the single highest-delight feature for residents. But CC&Rs are legal documents and an AI hallucination there is a lawsuit. Where exactly do we draw the line between "search" and "interpretation," and how do we surface uncertainty?
5. **Property manager mode — wedge or distraction.** If we ship multi-association mode in v1.2, do small property managers actually adopt, or do we just attract a long tail of one-association users who paid us $99 and a half-engaged property manager who wanted FrontSteps for free?
6. **In-House Cloud overlap.** For larger associations, the In-House Cloud pitch is genuinely compelling. But it's a capital sale, not a SaaS sale, and it changes the deal cycle entirely. Do we offer it from day one or treat it as a year-two enterprise tier?
7. **Insurance and bonding integration.** State-required fidelity bonds, D&O insurance, building insurance — every association renews these annually and most do it badly. Real opportunity, but is it a feature or a vertical of its own?
8. **The hostile-board problem.** What do we do when our customer (a board) uses HOAscope to do something genuinely abusive to a resident? We are not a legal authority and we don't want to be a referee, but we also don't want to be the tool of choice for retaliatory enforcement. There is a values question here that we should answer before a journalist does.

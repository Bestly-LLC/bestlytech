# SchoolPilot — feature inventory and pilot proposal

A Bestly product. For K-12 district leadership review.

---

## Executive summary

SchoolPilot is a privacy-first companion app that gives parents, students, teachers, and district leadership a single, calm view of school life — schedules, grades, assignments, attendance, and communication — without replacing the SIS, LMS, or comms platform a district already runs. It is additive, not displacive. It reads from PowerSchool, Skyward, Infinite Campus, Schoology, Canvas, and the rest of the existing stack, and gives every household the same clean experience regardless of how many vendors a district has accumulated. For a superintendent, the value is consolidation without procurement risk: one new tool that finally makes the existing tools usable, with FERPA, COPPA, and state-law compliance built in from day one.

## The administrative pain

Most US districts have arrived, more or less by accident, at a stack that looks like this: a legacy SIS for grades and attendance, an LMS for coursework, a separate parent-comms tool, a separate mass-notification tool for emergencies, an early-childhood app for K-2 photos, and somewhere between two and five teacher-driven tools (Remind, ClassDojo, Google Classroom announcements, a class website, a paper folder) that nobody at the district level actually approved. Parents see all of it. Teachers maintain all of it. Nobody owns the experience.

The cost shows up in five places.

**Parent communication fragmentation.** A parent of two children at two schools routinely manages five to nine apps and email threads to know what is happening that week. Engagement drops. The district then buys another comms tool to "fix" it, and the parent now has ten.

**SIS-vs-LMS-vs-comms tool sprawl.** Each system was procured to solve one problem and is contractually locked in for three to seven years. Replacing any of them is a multi-quarter project. So instead, districts add. The annual line item for "platforms, communication, and family engagement" creeps past $40-$60 per student per year in many mid-size districts, and nobody can produce a single dashboard that summarizes what the district actually owns.

**Equity gaps in access.** The free-and-reduced-lunch family with one shared phone, intermittent data, and a primary language other than English is the family the existing stack serves worst. Apps require accounts, accounts require email addresses, email addresses require setup help, and translation is an afterthought bolted onto comms tools that were architected for English-speaking suburban districts in 2014. The result is measurable: lower attendance at parent-teacher conferences, lower assignment completion, lower opt-in to emergency notifications, almost entirely along income and language lines.

**Teachers as the comms layer.** When the institutional tools fail, teachers absorb the gap. They text from personal phones, run private group chats, photocopy paper, and field anxious 9pm emails. This is unpaid labor, and it is the single most cited reason for early-career teacher burnout in district exit interviews.

**Board reporting that takes weeks.** Pulling family-engagement metrics, equity-of-access metrics, or assignment-completion patterns across the district requires pulling exports from four to seven systems and reconciling them in Excel. By the time the board sees the data, it is a quarter old.

SchoolPilot is built specifically for these five failure modes.

## What SchoolPilot is

A mobile and web app, parent-facing and student-facing, that presents one clean view of every child's school day. It reads from the systems the district already runs and presents the unified result. It supports the languages families actually speak. It works on a five-year-old Android phone on a 3G connection. It does not require accounts for students under 13 in COPPA-protected modes.

What it is not: a replacement SIS, a replacement LMS, a gradebook, an attendance system of record, or a teacher-grading tool. Those systems exist and they work well enough at what they do. SchoolPilot sits one layer up and turns the patchwork into a product.

The mental model: the district's existing stack is the back office. SchoolPilot is the storefront.

## Features by stakeholder

### Parents and guardians

The primary user. The app must be usable in under sixty seconds on a phone in a parking lot. Eight features:

1. **Unified weekly view.** All children, all schools, on one screen. Schedules, today's assignments, today's attendance status, today's lunch menu, today's after-school events.
2. **Grades and progress.** Current grades pulled from the SIS, with trend indicators. No raw gradebook. A parent sees "B in math, trending up over the last two weeks" — actionable, not alarming.
3. **Assignment visibility.** What is due, when, and whether the student has acknowledged it. Pulled from the LMS where one exists, from the SIS where it does not.
4. **Attendance and tardies.** Real-time when the SIS supports it, with clear reasons, and one-tap "report absent" that posts back to the SIS through the documented attendance API.
5. **Two-way teacher messaging.** Threaded by child and by class. Auto-translated in both directions across 100+ languages. Teachers see the original; parents see their language; both see a small "translated" tag.
6. **District and school announcements.** Filtered to the schools the parent's children actually attend. No mass blasts about the high school football team to a kindergarten parent.
7. **Calendar with one-tap subscribe.** Adds school, class, and district events to Apple/Google calendar via standard ICS feeds. No app required to consume.
8. **Emergency alerts.** Latency-critical notifications routed via push, SMS fallback, and (where the district uses it) integration with existing mass-notification systems like Blackboard Connect or ParentSquare.
9. **Lunch balance and meal program status.** Pulled from the food-service system. Free/reduced-price status is never shown to anyone except the parent themselves.
10. **Document inbox.** Permission slips, report cards, IEP/504 documents (with appropriate access control), enrollment forms. Parent can sign and return without printing.

### Students

A separate, age-appropriate experience. The student view is intentionally not a smaller version of the parent view.

1. **My day.** A simple "what's happening right now and next" screen. Period, classroom, teacher, what to bring.
2. **Assignments and due dates.** Their own view, with progress checkmarks and gentle reminder logic that does not turn into nagging.
3. **My grades.** Age-gated. Middle and high school students see grades. Elementary students see effort and behavior signals if the school uses them, never letter grades.
4. **Schedule changes.** Substitute teacher today, gym moved to the auditorium, club cancelled. The information that actually matters to a 13-year-old at 7:45am.
5. **Lunch menu and remaining balance** for older students, with the same privacy-of-status rule as the parent view.
6. **Two-way teacher messaging** — middle and high school only, with district-configurable monitoring and audit logging. Off by default in elementary.
7. **Activities and clubs.** Sign up, get reminders, see who else is going. Optional and district-configurable.
8. **Privacy controls the student understands.** A plain-English settings page that shows them what the app knows about them and what their parent can see.

The student app is COPPA-compliant for under-13 use under direct parental consent, with no behavioral advertising, no third-party trackers, and no data resale, ever.

### Teachers

The hard rule: a teacher should not feel like the district bought them another platform. SchoolPilot reads from what teachers already use; it does not ask them to enter anything twice.

1. **Read-only roster sync** from the SIS. The teacher's class list shows up automatically.
2. **Inbound parent messages,** organized by class and student, with translation already applied. A teacher writes once in English; 27 families read in their own language.
3. **Office hours and availability.** Teachers can publish a window; parents can request a 10-minute slot. No scheduling chaos in inboxes.
4. **One-button announcement** that hits the parents of one class, one section, or one homeroom — never a districtwide blast a teacher accidentally cc'ed everyone on.
5. **Assignment publishing** — optional, only if the teacher is not already using an LMS. Otherwise SchoolPilot reads the LMS and the teacher does nothing.
6. **Light analytics.** "Three families haven't opened a message from me in two weeks." Actionable. Not a dashboard.
7. **Quiet hours enforced by default.** No notifications to teachers between 5pm and 7am, weekends off, holidays off, district-configurable.

That's the entire teacher surface. By design.

### Building admins and principals

1. **Building dashboard.** Attendance trends, family engagement (open rates, response times), discipline summaries, this-week-this-school view.
2. **Communication audit.** Every district-level and school-level message sent in the last 90 days, who sent it, who received it, open rates by language and by school.
3. **Family-engagement equity view.** Open and response rates broken out by language, free-and-reduced-lunch status, and grade. The thing every principal wants and almost no current tool provides cleanly.
4. **Substitute and schedule-change broadcast.** One screen, one button.
5. **Parent-meeting scheduler.** Conference week organized, with translation interpreter requests routed automatically.
6. **Crisis mode.** A single switch that elevates the building to emergency posture, suppresses non-essential notifications, and routes all comms through verified channels.
7. **Roster and SIS sanity checks.** Flags students whose parent contacts haven't opened a single message in 30 days. Often a data-quality problem that nobody noticed.

### District admins and superintendents

The data-rollup layer. This is what makes SchoolPilot a district tool rather than a school tool.

1. **District dashboard.** All schools, all grades, side by side. Attendance, engagement, communication volume, opt-out rates.
2. **Equity-of-access dashboard.** App adoption, message open rates, and parent response rates broken down by school, language, ELL status, F/R-lunch status, and special-education status. Designed for the conversation a superintendent has with their board about whether the district is actually reaching every family.
3. **Communication policy controls.** Quiet hours, retention windows, who can send districtwide vs. school-wide vs. classroom-wide, what gets logged, what gets translated, what requires legal review.
4. **Board-reporting exports.** One-click PDF and CSV exports formatted for board packets — engagement, attendance correlation, family-survey rollups.
5. **Pilot and rollout phasing.** Enable SchoolPilot at one school, one grade, or one cohort. Compare engagement metrics against the rest of the district during the pilot. Fold in or roll back based on data.
6. **Vendor consolidation tracker.** Which existing tools the district can sunset, and on what timeline, as adoption grows. With per-tool annual cost.
7. **FERPA disclosure log.** Every data access, every export, every integration sync, queryable by student.
8. **State reporting hooks.** Outputs aligned to state-required reports for family engagement, chronic absenteeism (where required), and Title I family-engagement compliance.
9. **Single sign-on and identity governance.** Tied to the district's existing IdP (Clever, ClassLink, Google for Education, Microsoft Entra). Provisioning and deprovisioning are automatic.
10. **Branded experience.** District name, district colors, district logo. The app a parent installs is the district's app, not a Bestly app.

## District-level capabilities

The capabilities that exist only because SchoolPilot operates at the district scope rather than the classroom scope:

**Equity dashboard.** This is the differentiator. SchoolPilot computes engagement, response, and access metrics broken down by every demographic the district already tracks in the SIS — without exposing personally identifiable data to any user who shouldn't see it. It is the first time most districts will see how their existing comms stack actually performs across language and income lines. In every pilot we've scoped, the dashboard surfaces at least one engagement gap the district was not aware of.

**Multi-school handling.** A parent with three children across three schools sees one merged feed. A district admin can configure each school's policy separately — different quiet hours, different translation defaults, different escalation rules — and SchoolPilot resolves conflicts predictably (most-restrictive-wins for student notifications, most-permissive-wins for accessibility features).

**Phased rollout.** A pilot does not have to be districtwide. SchoolPilot supports:
- One-school pilots
- One-grade-band pilots (e.g., elementary only, or just middle school)
- Cohort pilots (e.g., all 5th graders across the district)
- Opt-in family pilots (any family that wants in, regardless of school)

Each phase has independent telemetry and can be rolled back without affecting the rest.

**Board-reporting exports.** PDF templates that mirror the format your board secretary already uses. CSV exports for any custom analysis. A quarterly auto-generated "family engagement report" emailed to the superintendent and ready to forward to the board.

**Survey instrument.** Light-weight, district-configurable parent surveys delivered through the app — topic, frequency, languages — with results auto-broken-down across the same equity dimensions as the engagement dashboard. Replaces the standalone survey tool many districts pay for separately.

## Integration

SchoolPilot is additive. It does not replace your SIS. The integration model is read-mostly, with narrowly scoped writes.

| System category | Examples | Read | Write | Notes |
|---|---|---|---|---|
| SIS | PowerSchool, Skyward, Infinite Campus, Aeries, Tyler SIS | Roster, schedules, grades, attendance, contacts | Parent-reported absences only, attendance API where supported | OneRoster v1.2, Ed-Fi, or vendor-native API |
| LMS | Canvas, Schoology, Google Classroom, Microsoft Teams for Education | Assignments, due dates, course materials index | None | LTI 1.3 + native APIs |
| Identity | Clever, ClassLink, Google for Education, Microsoft Entra | SSO, roster sync, deprovisioning | None | SAML 2.0 / OIDC |
| Mass notifications | Blackboard Connect, ParentSquare, Remind, ClassDojo | Read-only, optional | Optional outbound co-send for emergencies | Most districts run one of these alongside SchoolPilot during pilot |
| Food service | Nutrislice, Linq, Titan | Menus, balance, F/R-lunch status | None | F/R status never displayed except to the parent |
| Transportation | Tyler Drive, Edulog, Zonar | Bus assignments, real-time location where supported | None | Optional |
| Single sign-on for parents | Clever Parent Portal, native email/phone | Auth | Auth | Magic-link is the default; no parent passwords by design |

The boundaries matter. SchoolPilot does not write grades. SchoolPilot does not modify rosters. SchoolPilot does not change the SIS's record of what happened. The only writes are parent-attested absences (which the SIS attendance clerk still reviews), parent message replies, and parent-acknowledgement of documents — exactly the writes parents already make through paper and phone calls today, just structured.

## Privacy and compliance

This is the section that decides whether a superintendent can defend the pilot at the next board meeting.

**FERPA (20 U.S.C. § 1232g).** SchoolPilot operates as a "school official" with a "legitimate educational interest" under the FERPA section 1232g(b)(1)(A) and 34 CFR § 99.31(a)(1)(i)(B) — provided the district designates it as such in its annual FERPA notification. Bestly signs a Data Privacy Agreement that mirrors the Student Data Privacy Consortium's National DPA framework. Bestly does not redisclose student records. Bestly does not use student data to train AI models. Bestly does not sell, license, or share student data with any third party for any purpose, ever.

**COPPA.** For students under 13, SchoolPilot operates under the school-consent exception, which permits the district to consent on behalf of parents for educational purposes. We document that consent in writing. Behavioral advertising is structurally impossible — there is no ad system in the product.

**State student-data privacy laws.** SchoolPilot is designed to comply with:
- California SB-1177 (SOPIPA)
- New York Education Law § 2-D and Part 121 regulations
- Illinois SOPPA (105 ILCS 85)
- Connecticut Public Act 16-189
- Colorado HB 16-1423
- Texas Education Code 32.151–32.157
- Virginia §22.1-289.01

The district receives a state-specific compliance addendum during contracting. Where state law requires explicit posting of subprocessors, SchoolPilot's subprocessor list is published and changes require 30-day notice.

**Data residency.** Student data is stored in US-based data centers, in a tenant logically isolated per district. For districts with stricter residency needs (or for the Bestly In-House Cloud model — see below), the entire SchoolPilot stack can be deployed on hardware in the district's own data closet, with zero data leaving district premises. This is a real option, not a marketing line; Bestly's flagship product is private-cloud infrastructure for organizations that want their data to stop leaving the building.

**Parental consent flows.** Districts can configure SchoolPilot to require explicit parental consent before activating any optional feature — directory-information sharing, photo display, location features for transportation, age-appropriate communication settings. Consent is auditable and revocable.

**Encryption.** TLS 1.3 in transit. AES-256 at rest. Per-district encryption keys with optional district-managed key escrow.

**Auditing.** Every data access by any Bestly employee is logged, immutably, and the log is queryable by the district. Bestly has not had a breach. If we ever do, the district is notified within 24 hours, well inside any state-required timeline.

**SOC 2 Type II.** In progress; expected audit completion before the second pilot district goes live. Bestly's security posture is built on the same infrastructure that runs Bestly's enterprise In-House Cloud product, which is already deployed in regulated-industry environments.

## The pilot proposal

A 6-month pilot designed to be greenlightable inside a superintendent's existing authority, without a board vote, in most district policy environments.

**Scope.** One school, or one grade band across the district, or an opt-in family cohort — superintendent's choice. Target reach: 300-1,500 students.

**Pricing during pilot.** Free. No license fee, no per-student fee, no setup fee. Bestly absorbs the cost in exchange for the design partnership, the case-study rights (anonymized or named at the district's option), and the right of first negotiation if the district moves to district-wide.

**What's measured.** Five metrics, agreed up front:
1. Family adoption rate (% of households with at least one active user)
2. Open rate of school-to-home communications, baseline vs. pilot
3. Open- and response-rate equity (gap between English-speaking and non-English-speaking households, F/R-lunch and non-F/R-lunch households)
4. Teacher comms time (self-reported survey, pre and post)
5. Parent satisfaction (one short survey at month 1, month 3, month 6)

**Phases.**

| Month | Phase | Activity |
|---|---|---|
| 1 | Stand-up | SIS/LMS integration, identity provisioning, branding, DPA signed, principal training |
| 2 | Soft launch | Pilot cohort onboarded, weekly feedback loops, hot fixes |
| 3 | Steady state | Full feature use, midpoint review, equity dashboard delivered to superintendent |
| 4 | Expansion option | Add a second school or grade band if month-3 metrics support it |
| 5 | Findings | Board-ready report drafted with the superintendent's office |
| 6 | Decision | Continue at full district pricing, extend pilot, or sunset cleanly |

**Exit criteria.** The pilot ends and SchoolPilot is uninstalled, with all student data destroyed under verifiable deletion within 30 days, if any of the following are true at month 6:
- Adoption is below 25% of eligible families
- Equity gap on open rates has widened versus baseline
- Any documented FERPA or DPA violation
- The superintendent simply changes their mind

No multi-year lock-in. No early-termination fee. No data hostage situation. A pilot exit is a feature, not a friction point.

**What success looks like.** In conversations with prospective districts, the bar we have set internally is: 60%+ household adoption, a 2x improvement in open rates among non-English-speaking families, and a quarter of one school administrator's full-time-equivalent hours returned to other work. Those numbers are aspirational and we will be transparent about whether the pilot is hitting them.

## Differentiation

A direct read on the competitive landscape. Each of these vendors does something well; none of them is doing the thing SchoolPilot is doing.

| Competitor | What they do well | Where they fall short for a superintendent |
|---|---|---|
| PowerSchool | The system of record. Deep, complete, owns the data | Parent app is widely regarded as dated; not built for the cross-school experience; family-engagement reporting is thin |
| Skyward | Strong in mid-size districts; integrated finance | Parent UX is functional, not delightful; languages and equity reporting are bolt-ons |
| Infinite Campus | Solid SIS, good portal | Same family-engagement gap; no native cross-system aggregation |
| Schoology / Canvas | Best-in-class LMS | Parent surfaces are an afterthought; equity reporting is course-by-course, not district |
| ClassDojo | Beloved by K-5 teachers and families | Teacher-driven adoption means inconsistent district visibility; engagement skews younger; not a districtwide platform |
| ParentSquare | Strong unified comms experience | Comms-only; doesn't pull in grades, assignments, or schedules; districts often pay for it on top of an SIS portal that nominally does the same job |
| Remind | Lightweight teacher messaging | Single-feature; not a district platform; parents end up with multiple Remind feeds for multiple kids |
| Blackboard / Anthology | Mass-notification, deep enterprise relationships | Notification-focused; family experience is utilitarian |

The honest differentiation: we are not trying to be the system of record. We are trying to be the layer above the system of record that finally makes the rest of the stack usable for families. That is a much smaller surface area, which means we can ship faster, charge less, and exit a pilot cleanly if it isn't working — none of which the legacy vendors can credibly offer.

The other honest differentiation: privacy by default. The legacy vendors operate large data businesses. ClassDojo has been the subject of long-running questions about data-monetization adjacencies. Bestly's entire company thesis is privacy-first. There is no ad system. There is no data-resale option in the product. There is no AI-training pipeline that ingests student data. The privacy posture is the product, not a marketing tab.

## Pricing model

Two models, designed to be selectable by the district based on what is easier to defend in their own budget process.

**Model A — per-student, per-year.** $3 to $5 per enrolled student per year, all-in. Includes all features, all stakeholders, all integrations, unlimited support seats, and the equity dashboard. A 5,000-student district pays $15,000 to $25,000 annually. For comparison, a typical comms tool alone runs $3-$8 per student per year and does a fraction of what SchoolPilot does.

The case for this model: it scales cleanly with district size, is easy to explain to a board, and aligns SchoolPilot's revenue with the district's actual headcount. The risk: in a budget cut, per-student-per-year line items are visible and easy to target.

**Model B — district flat fee.** $20,000 to $80,000 per year depending on district size band (under 2,000 students, 2,000-10,000, 10,000-25,000, 25,000+). All features, unlimited students.

The case for this model: predictable budgeting, no surprise costs as enrollment shifts, and the line item appears once on the district's consolidated platform budget rather than scaling with student count. The risk: smaller districts may pay more per student than they would under model A.

**Pilot model.** As stated above: free for six months. No setup fee. No data-extraction fee at exit. The pilot is genuinely free, not free-with-strings.

A note on procurement: SchoolPilot can be acquired directly via district contract, via state contract vehicles where Bestly is listed (in progress), or via cooperative purchasing through TIPS, Sourcewell, and AEPA. We can also be paid out of Title I, Title III, and Title IV-A funds where the district's family-engagement plan supports it; we will provide the language for your federal-programs director.

## Implementation timeline

A typical district onboarding from contract signature to pilot live, week by week. This is not theoretical — it is the same cadence we run the Bestly In-House Cloud onboarding at, adapted for K-12.

**Week 1 — Discovery.** Two calls. One with the superintendent's office and the technology director. One with the SIS administrator and the curriculum/communications lead. Output: a written scope brief that lists every system SchoolPilot will integrate with, the pilot cohort, the success metrics, and the legal/compliance contacts.

**Week 2 — Contracting.** DPA signed (Bestly accepts the district's DPA template; we have signed every variant the SDPC publishes). MSA signed. SSO and integration credentials provisioned with read-only scope.

**Week 3 — Integration.** SIS connector configured. LMS connector configured. Identity provider connected. Branding applied. A staging instance comes up with synthetic data for QA.

**Week 4 — Internal preview.** Five to ten district staff use the staging instance with their real (read-only) data. We fix what they find. The technology director signs off on a security review.

**Week 5 — Pilot training.** Principals and front-office staff trained, 60 minutes. Teachers in pilot cohort trained, 30 minutes (it is genuinely a 30-minute training because we are not adding to what they do). Family communication drafted with the district's communications lead.

**Week 6 — Soft launch.** Pilot cohort families receive the announcement and onboarding link. App goes live. Daily monitoring of error rates, adoption rates, support tickets. We staff a dedicated channel for the first two weeks.

**Week 7-8 — Stabilization.** Issues triaged and resolved. First parent survey at the end of week 8.

**Week 9 onward — Steady state.** Monthly metrics review with the superintendent's office. Quarterly board-reporting export. Continuous improvement on whatever the district's equity dashboard reveals.

The total time from contract to families using the app: 6 weeks. The total time from first conversation to families using the app: typically 8-10 weeks, depending on procurement cadence.

---

## What to do next

If this document leaves any open question that would be the deciding factor for greenlighting a pilot — regulatory, technical, financial, or political — that is exactly the conversation Bestly would like to have. Thirty minutes with the superintendent and the technology director is enough to scope a pilot, and we leave the call with a written brief regardless of whether the district moves forward.

Contact: Eli at Bestly — pilots@bestly.tech — or jared@bestly.tech directly.

Bestly is a privacy-first product studio. Privacy by design, less data more trust, zero data sales, global standards. Those are the same defaults SchoolPilot ships with on day one.

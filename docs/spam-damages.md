# Spam damages, in plain words (2026-10-07)

What Spam Desk's "claims" are, what the law actually says, and what Scout will and will not do. Scout is not a lawyer. This page
explains the idea; it is not legal advice. Before anything is sent to a business, Jared reads the letter and taps a confirm
dialog. Scams and phishing are only ever reported to the abuse desks, never turned into claims.

## The one-line version

California lets the person who got an unwanted commercial email sue the advertiser for **$1,000 per email**, but only when the
email is **deceptive** in one of three specific ways. Plain junk mail that is just annoying does not qualify.

## The law: California Business and Professions Code section 17529.5

Source (full text, checked 2026-10-05): https://california.public.law/codes/ca_bus_and_prof_code_section_17529.5 (mirrors the
state's own site, https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=17529.5).

**What counts as a violation.** It is unlawful to advertise in a commercial email sent from California or to a California email
address when any one of these is true (subdivision (a)):

1. The email carries someone else's domain name without that person's permission.
2. The email has forged, falsified or misrepresented header information (who it is from, where it came from).
3. The subject line is one the sender knows would likely mislead a reasonable recipient about a material fact about what the
   message is or contains.

**Who can sue** (subdivision (b)(1)(A)): the Attorney General, an email service provider, or **a recipient of an unsolicited
commercial email advertisement**. That last one is Jared.

**"Unsolicited"** (section 17529.1): a commercial email sent to someone who never gave direct consent to that advertiser and has
no existing business relationship with it (an inquiry, application, purchase or transaction). Newsletters Jared signed up for do
not qualify, which is why Spam Desk never opens a claim on its own: only his Spam tap, which says he never asked for it, does.

**What can be recovered** (subdivision (b)(1)(B), (C)):

- Actual damages, and/or
- **$1,000 for each unsolicited email that violated the section, up to $1,000,000 per "incident"** (an incident is one send of
  substantially similar content, to one or many recipients), plus
- reasonable attorney's fees and costs if the recipient wins.

**The reduction** (subdivision (b)(2)): if the advertiser proves it had good practices and procedures reasonably designed to
prevent violating emails, the court must cut the damages to **$100 per email, $100,000 per incident**.

**Who is not liable**: a mail service that only routinely carries the message (subdivision (b)(1)(D)).

**Other rules in the section**: the violation is also a misdemeanor (subdivision (c)); you cannot recover under this section and
under section 17529.8 or 17538.45 for the same email (subdivision (b)(3)).

## The deadline

The $1,000 is a penalty, and the California Court of Appeal held in *Hypertouch v. ValueClick* (2011) that a **one-year**
limit applies to the $1,000-per-email damages; actual damages get three years. Source:
https://caselaw.findlaw.com/court/ca-court-of-appeal/1555492.html. In practice: **only emails from the last 12 months are worth
claiming.** Spam Desk puts the first and last email dates on each claim so this is visible.

The same case held the federal CAN-SPAM Act does not push these claims out of court, and that an **advertiser can be liable for
emails its affiliates send**, even without knowing about them.

## The federal law does not give Jared a claim

CAN-SPAM lets only the FTC, state attorneys general and internet providers sue. Individuals cannot. It overrides state email
laws except to the extent they target "falsity or deception", which is why California claims have to be about a forged header,
someone else's domain or a misleading subject line. Source: https://terms.law/Demand-Letters/respond/email-anti-spam/can-spam-preemption.html

## What courts have said "falsified header" means

- *Kleffman v. Vonage* (California Supreme Court, 2010): sending ads from many different domain names to get past spam filters is
  **not** a forged header by itself, as long as the header information is accurate and traceable.
  https://en.wikipedia.org/wiki/Kleffman_v._Vonage_Holdings_Corp.
- *Balsam v. Trancos* (Court of Appeal, 2012): emails whose sender could not be traced to anyone through public records, because
  the sending domains were registered privately, **did** carry misrepresented header information. The trial court awarded $1,000
  for each of seven emails plus about $81,900 in attorney's fees. https://blog.ericgoldman.org/?p=10455

So the strongest emails are the ones where you cannot tell who sent them, or where the subject line promises one thing and the
message sells another. An ordinary ad from a named company with an honest subject is the weakest.

## How Spam Desk uses this

- Tap Spam on advertising from a business: the report goes out as for any spam, the sender is blocked, and **a claim file** opens
  (or grows) for that advertiser's domain: count of emails, first and last dates, "up to $1,000 x count".
- Not for scams or phishing, not for freemail senders (gmail, yahoo and so on), not when the free AI says the business is clearly
  outside the US. Mail from a blocked advertiser that keeps arriving is added to the same claim automatically.
- "Draft letter" has the free AI write a short, plain demand letter from the evidence only (dates, sender, subject lines,
  statute, total, 14 days to answer). It leaves one `[Jared: ...]` line for the part only he can judge: what exactly was
  forged or misleading. The page will not send until that line is filled in.
- "Review and send" opens a dialog naming the recipient. Only the confirm button, pressed from Jared's signed-in admin, sends it,
  from jared@bestly.tech with his Bestly signature. Scout, the hourly job and Scout's chat tools cannot send it.
- The recipient address is typed by Jared. Scout does not guess a legal contact.

## What Jared should know before sending one

- The claim only works when one of the three deceptions is true. Check the header and the subject line.
- He must be able to say truthfully that he never signed up and never did business with them.
- A letter is a demand, not a lawsuit. Collecting usually means small claims court (it has a dollar cap; check the current one)
  or a lawyer who takes these cases. Many California anti-spam suits are brought by lawyers.
- A lawyer (the State Bar of California runs a certified referral service, usually with a free or cheap first consult) can say
  whether a specific email is worth pursuing.

## Sources checked 2026-10-05 and 2026-10-06

- Statute text and definitions (sections 17529.5 and 17529.1): california.public.law pages above.
- *Hypertouch v. ValueClick* (2011): FindLaw copy of the opinion; read for preemption, the one-year and three-year limits, and advertiser liability.
- *Kleffman v. Vonage* (2010) and *Balsam v. Trancos* (2012): summaries linked above (not the opinions themselves).
- CAN-SPAM enforcement and preemption: terms.law summary.
- Not verified here: any case decided after 2012 (for example on "from" line names), and the current small-claims dollar limit.

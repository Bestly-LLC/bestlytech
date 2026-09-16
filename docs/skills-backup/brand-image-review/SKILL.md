---
name: brand-image-review
description: "Use before publishing, queueing, or approving ANY image for Jared's brands — social posts, ads, listing photos, OG cards, labels. Images carry claims that text gates never see."
---

# Brand image review

## Why this exists

A HOKU Instagram post went live showing a product render whose label read
**"PREMIUM FACE & SKIN REFRESH"** and **"Premium-grade HOCl"** — on a **pump
bottle**, beside a caption that said *"a face spray in a sealed can"* and *"No
pump."*

Every one of those words was already banned. A three-tier compliance gate
blocked them in captions and headlines. It never fired, because **the gate read
text columns and the claim was pixels.**

The rule that follows from that:

> **A claim in an image is a claim.** Any rule that applies to copy applies to
> anything rendered inside a picture — label text, packaging mockups, badges,
> chart labels, alt text, on-image captions.

## Before any image ships

Run all five. Any failure blocks it.

1. **Read the pixels, not the prompt.** Open the rendered file and read every
   word visible in it. Do not trust the brief, the filename, or the template.
   Rendered output is the only thing that counts.
2. **Run the visible text through the copy rules.** Same claim constraints as
   `plain-language-brand-copy`. For HOKU that means no *premium*, *first*,
   *only*, *dermatologist tested*, *non-cytotoxic*, no kill/disinfect/sanitize/
   heal/antimicrobial, no *Made in USA*, no *vacuum-sealed*.
3. **Does the picture match the caption?** They ship in one frame and the viewer
   reads them together. A caption saying "sealed can, no pump" beside a pump
   bottle is worse than either alone — it reads as a lie about the product.
4. **Is this the actual product?** A render, mockup, comp, or AI-generated
   stand-in is not the product. If the real thing is not photographed yet, ship
   type-only layouts. Never a stand-in that a customer would read as real.
5. **Look at the whole frame at posting size.** Garbled label text, dead space
   in the bottom half, a `01 / 06 · SWIPE ›` marker on a single image — these
   are invisible in code and obvious on a phone.

## "Hold" means the queue too

Jared said to hold graphics work until the final label existed. New generation
stopped. **49 already-scheduled posts kept running**, and one of them is what
went out.

> When told to hold, stop what is already scheduled, not just what is new.
> Check the queue, the cron, and anything with a future timestamp — then say
> what was found and what was stopped.

## Make it structural, not remembered

A rule that lives only in a prompt fails the next session. Enforce it where the
data is.

- HOKU: `hoku_approved_photo_keys` is an allowlist; a trigger on
  `hoku_content_bank` refuses to set `queued_at` for an unapproved `photo_key`.
  Approval is a human writing a reason into the row.
- Default any new asset to **not approved**. Opt-in, never opt-out.
- After building any gate, test that it actually blocks — attempt the thing it
  forbids and confirm it raises.

## When one has already shipped

Stop the bleeding before writing the explanation.

1. Stop every path that publishes: the cron, the generator flag, and the row
   status. Three independent stops, because one can be undone by accident.
2. Count the blast radius — how many are queued, how many already live.
3. Tell Jared plainly what went out and what it claimed. Do not soften it.
4. Taking down live published content is his call, not yours. Surface it.
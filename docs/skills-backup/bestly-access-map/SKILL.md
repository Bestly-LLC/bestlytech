---
name: bestly-access-map
description: "Check before saying an account, mailbox, file store or API is unavailable, before sending any email as Jared, and whenever asked what access exists, what a system holds, or where a password lives. Reads Jared's credential registry in Supabase rather than guessing."
---

# What access exists, and where the keys are kept

App passwords are shown once and then vanish. Sessions end and take their context
with them. So the same question kept getting re-asked and re-answered wrongly:
*do you have the password for X?*

The durable answer lives in Supabase, not in any one conversation.

## Look here first

Project `rcqfqhguwpmaarseifqg`, table `bestly_credential_registry`:

```sql
select system, account, status, purpose, holds, secret_home, secret_ref,
       reachable_by, notes, verified_at
from bestly_credential_registry
order by system;
```

Columns worth knowing:

- `holds` — what content actually sits behind that access. This is the answer when
  Jared asks what a system contains.
- `secret_home` — where the secret physically lives (macOS Keychain, Supabase Vault,
  a third-party account). **The registry never stores secret values**, and a database
  trigger rejects anything that looks like one.
- `reachable_by` — `sandbox`, `edge-function`, `mac`, `worker`. If the only route is
  `mac` and the device bridge is offline, that access is unavailable *right now* even
  though the credential is fine. Say which of the two it is.
- `status` — `active`, `revoked`, `needed`, `unknown`.

## Rules

**Never claim access is missing without querying this table.** Three times now the
answer was "I don't have that" when the real situation was different: once the
credential existed but the route was offline, once a whole connector had been silently
killed by a revoked app password, and on 2026-09-16 an entire session ran on the belief
that there was no email access while the mailbox sync was healthy and current. The
query takes two seconds. Run it before the sentence.

**Never ask Jared to paste a password into chat.** Secrets go where they belong:

- A Mac-side secret goes to Keychain straight from the clipboard, never displayed:
  `security add-generic-password -a "<account>" -s "<service>" -w "$(pbpaste)" -U`
  then `pbcopy < /dev/null`.
- A server-side secret goes to Supabase Vault and is read only inside an edge function.

**Keep the registry current.** Whenever access is gained, revoked, moved or verified,
update the row in the same turn — including `verified_at`. A stale map is worse than
no map, because it gets trusted.

**Record what a store holds, not just that it exists.** "490 messages from 2026-04-09,
including CA Secretary of State and CDTFA notices" is useful. "Email access" is not.

## Email: reading works, sending does not

This gets its own section because getting it wrong puts real mail in front of real
people.

**Reading is live.** Two mailboxes sync continuously from an IMAP puller on Jared's Mac
into `bestly_mail`, keyed on `(mailbox, folder, uid)`: `jared@bestly.tech` (business)
and `jaredbest@icloud.com` (personal). Check freshness in `bestly_mail_state`. The sync
opens folders read-only, so nothing is ever marked seen. Attachments are **not**
carried — `has_attach` is only a boolean and no bytes are stored, so an attachment-only
message is unreachable without the Mac.

**There is no way to send as Jared.** `bestly_mail_queue` looks like a send queue and is
not — it is a mailbox *action* queue (move, mark, file), keyed by uid. Nothing in the
stack composes or sends from his mailbox.

**So when Jared says "send it for me", lay out what actually exists and let him pick
before anything goes out.** Handing him the finished draft to send from his own client
is not the lesser outcome — it is the only one that produces a message he owns.

**Never send Jared's correspondence through Resend.** Resend is the storefront's
transactional pipe (verified domains `news.hoku-clean.com` and `bestly.tech`, reached
through the `bestly-resend-status` edge function, whose `send` action will accept any
`from` you hand it). It will work, and that is the trap. The message never touches his
mailbox: no copy in Sent, no thread to reply within, nothing he can find later — and it
spends the store's sending reputation on personal mail. On 2026-09-16 the Apple
brand-verification email went out this way and was delivered correctly; the instruction
afterwards was "never do that again". Resend is for HOKU customer transactional mail and
deliverability testing. Nothing else.

**If a real send path is ever built**, it belongs in the same Mac bridge that already
reads — a `send`/`reply` action performed over SMTP from the actual mailbox, so there is
a genuine Sent copy and genuine threading. As of 2026-09-16 the action queue is not
being drained at all (21 items pending since 2026-09-03, zero attempts), so that has to
be fixed before anything new is queued into it.

## Related infrastructure

- `bestly_mail` / `bestly_mail_state` — synced mail, keyed on `(mailbox, folder, uid)`.
  Reads are strictly read-only; the sync never marks anything seen.
- Edge functions are gated by an `x-proxy-key` header. The Supabase anon key is public
  and is **not** authorization on its own.
- Each function should carry its own proxy key where a key has to travel; the shared
  key unlocks more than any single job needs.
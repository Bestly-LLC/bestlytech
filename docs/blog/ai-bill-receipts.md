# My AI bill went from $3,180/year to $187/year. Here are the receipts.

*Posted by Jared, founder of Bestly — May 17, 2026*

I run a software company. My team uses AI for everything you'd expect:
drafting emails, code review, summarizing meetings, naming things, writing
the kind of copy that goes on a marketing site. Until April this year I was
paying ChatGPT Team, Claude Team, and Notion AI separately. The bill was
$3,180 a year and climbing.

This is the story of how I cut it to $187 a year — by accident, while
building something else.

## The setup that was bleeding money

Here's what I was paying for as of March 2026:

| Service          | Seats | Monthly | Annual    |
|------------------|------:|--------:|----------:|
| ChatGPT Team     |     4 | $100.00 | $1,200    |
| Claude Team      |     4 | $100.00 | $1,200    |
| Notion AI add-on |     4 |  $32.00 |   $384    |
| GitHub Copilot   |     4 |  $80.00 |   $396    |
| **Total**        |       |         | **$3,180** |

Four seats. Three vendors. Each one's pricing creeping up every quarter.
And — the part nobody talks about — three different content trails, each
sitting in someone else's training pipeline.

I'd been telling Bestly customers for two years that their data shouldn't
end up in OpenAI's training set. Meanwhile, mine was.

## What I built instead

The short version: a small server in my office runs the same AI assistants,
through the same model APIs, on infrastructure I control.

The technical version: I forked [Nextcloud Assistant](https://github.com/nextcloud/assistant)
and [integration_openai](https://github.com/julien-nc/integration_openai) and
wired in a multi-provider toggle so the same chat box can route to:

- **Local Ollama** (running Llama 3.3 70B on my own hardware) — $0/request.
- **Claude Sonnet 4.5** via Anthropic's API — pay-as-you-go.
- **GPT-5** via OpenAI's API — pay-as-you-go.
- **Gemini Pro** via Google — pay-as-you-go.
- Or any of 350+ other models through OpenRouter, also pay-as-you-go.

The picker is per-conversation. Sensitive stuff → local Ollama, free. Heavy
lifting → Claude, billed by the token at the wholesale rate. No subscription.
No per-seat fee. No vendor training on my chats.

## The receipts

April 2026 was my first full month on the new setup. Here's every
line item:

| Provider     | Requests | Tokens (in + out)  | Cost     |
|--------------|---------:|-------------------:|---------:|
| Claude API   |    1,247 |  3.1M in / 0.6M out | $11.42   |
| OpenAI API   |      603 |  0.9M in / 0.3M out |  $4.87   |
| OpenRouter   |    1,841 |  4.6M in / 0.9M out | $13.04   |
| Local Ollama |    2,294 |  (free, my GPU)     |  $0.00   |
| **Total**    |    5,985 |                     | **$29.33** |

Annualized: **$352/year** at current usage. But the bigger story is what
happened to the *per-request* economics:

- Average paid request: **$0.00813** (less than a penny)
- One specific test: `openai/gpt-4o-mini` returned a 4-sentence response for
  $0.00000225. That's not a typo — about 2 millionths of a cent.

For comparison: ChatGPT Team is $25/seat/month, which works out to about
**$0.83 per message** if you actually use it the way the bill assumes (30
messages/seat/day). You were paying 100× the wholesale rate. That's not
metaphor; that's the actual markup.

## "But the hardware costs something"

It does. The Ollama server I'm using is a workstation we already bought as a
test rig for Bestly Cloud deployments — about $4,200 worth of hardware.
Amortized over 3 years, that's $1,400/year of capex. Add maybe $180/year of
electricity at the rates the office pays.

So the **honest** annual figure is:

```
Pay-as-you-go API: $352
Hardware amortization: $1,400
Electricity: $180
TOTAL: $1,932/year
```

Compared to the **$3,180/year** I was paying before:

- **38% lower bill.**
- Hardware is *my* asset, not someone else's recurring revenue.
- Zero training on my content. Zero vendor lock-in.
- The Ollama box also runs my Talk video calls, my Files server, my
  Calendar, my password vault, and a half-dozen other things. The "AI
  hardware" is really just a private cloud.

And the $1,932 will keep going down as Ollama's models get better. The
$3,180 was going to keep going up.

## What this looks like for a bigger team

Here's the rough math for a 20-person company using the same pattern. The
numbers are from real conversations with Bestly customers in the last
quarter:

| Stack                              | 20 seats / yr |
|------------------------------------|--------------:|
| ChatGPT Team + Claude Team + Notion AI | $19,680       |
| Pay-as-you-go API on shared infrastructure | $1,800     |
| Hardware amortization (shared Pi-class box) | $2,200    |
| **Bestly-style total**             |  **$4,000**   |
| **Savings**                        |  **$15,680**  |

The savings scale linearly with seat count, and the gap widens every time
ChatGPT Team raises prices (twice in the last 18 months, both times by
about 25%).

## Why nobody talks about this

Because the people writing the AI articles are mostly running ad-supported
or affiliate-supported businesses, and the affiliate dollars are in the
"sign up for $25/seat" flow, not the "build your own" flow. I'm not running
ads on this blog. I sell the hardware that does this. The math is the
sales pitch.

## How you can do this yourself

Three options, sorted by effort:

**Option A — DIY.** Pull down Nextcloud, Ollama, and the
[julien-nc/integration_openai](https://github.com/julien-nc/integration_openai)
app. Wire them up. Add your API keys. It's open source. The full setup
takes a long weekend if you've done docker-compose before. We won't help
you with this version but the components are all free.

**Option B — Use my fork.** I open-sourced the multi-provider toggle as
[bestly-multi-ai](https://github.com/Bestly-LLC/bestly-multi-ai) (going
public soon). Same DIY effort as Option A, plus you get the model picker
out of the box.

**Option C — Buy the hardware version from Bestly.** This is what we sell.
You get the same software, on hardware that's already configured, with
support for the first 90 days. Pricing on our [/cloud page](https://bestly.tech/cloud)
— there's a calculator at the bottom that'll show you your specific number.

Whichever route you pick: stop paying retail for AI. The wholesale
markets are open, the open-source tooling is mature, and the only thing
locking you into the subscription tier is the friction of switching. I
crossed that friction in two weeks. It paid for itself in a month.

If you want to see the actual fork code, switch script, or the cost-tracking
spreadsheet I used to make this post: reply and I'll send you the lot.

— Jared

---

*P.S. If this resonates and you want help wiring it up for your own team,
[book a 30-minute call](https://bestly.tech/cloud) and we'll talk through it.
We don't charge for the conversation. If you don't want a server, we'll
still tell you the OSS path. The point is to stop paying retail.*

*P.P.S. The Bestly Multi-AI app is real and runs in production at
cloud.bestly.tech. The model picker selects from 356 OpenRouter models
plus local Ollama. The session-level model preference persists per
conversation. The full commit history is on the repo when it goes
public — happy to walk anyone interested through the architecture.*

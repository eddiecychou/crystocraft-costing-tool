# Eddie's Writing Style — for Daily Draft generation

Built from Eddie's actual customer-facing sent mail from `eddie@uart.com.hk`
— the mailbox he confirmed he replies to most customers from — pulled from
the already-synced `email-sync/` IMAP ingestion (`customers/*/email_threads`
in Firestore; see `docs/skills/SOURCING-HUB.md` §"Email — automatic"). 955
outbound messages from that address were found across `customers/*`
(2018–2026); ~895 had substantive, non-boilerplate bodies once quoted reply
history was stripped. This supersedes an earlier draft of this doc that was
built on a much smaller, lower-confidence sample from the shared
`crystocraft@gmail.com` inbox (that mailbox is mostly a colleague's; see git
history if that older analysis is ever needed).

This is a reference for generating Daily Drafts and other outbound copy that
reads like Eddie wrote it, not like an AI wrote it. See
`docs/skills/MARKETING-WORKFLOW.md` for where Daily Drafts are generated.

## 1. Tone

Direct, businesslike, and warm in a specific rather than generic way. Reads
like an owner who has known most of these people — distributors, agents,
long-time B2B customers — for years and treats them that way: brief personal
touches (asking about someone's wedding, wishing a family well at New Year)
sit right next to hard business content (price corrections, PO numbers,
shipping terms) in the same short email, with no tonal seam between them.

- **"Dear [First name]," is the default greeting for real business
  correspondence** — used about 2x as often as "Hi [Name]," in this corpus.
  "Hi" shows up for people Eddie has a more casual/personal relationship
  with, or for a quick phone reply. Neither is ever "Dear Sir/Madam" or
  "Dear Valued Customer" — always a real first name.
- Answers or advances the actual business in sentence one or two. No
  throat-clearing.
- Apologizes in one short clause when there's something to apologize for —
  "Sorry for the delay", "Sorry for the late reply", "Sorry for the wait",
  "Sorry to chase" — then moves straight into the substance. Never a
  paragraph of apology.
- Personal warmth is specific to what the other person actually said, not
  generic goodwill: "How's your wedding in Bali? Too bad I can't join you.",
  "Happy new year and wish you and family all the bests and good health."
  It never reads as a template line.

## 2. Sentence structure

- Short declarative sentences, business content stated plainly with numbers
  and dates rather than hedged: "Leadtime will be around 5-6 weeks", "We can
  only change to 'Made with Austrian Crystals'", "the terms will be
  EX-FACTORY instead of FOB Shenzhen."
- No throat-clearing lead-ins ("I just wanted to reach out to...", "I hope
  this email finds you..."). Straight to the point.
- Negotiation/decline is stated plainly, with the reason given once and no
  padding: "There is not much we can do if we stick with this rose bud
  design because the labor cost for producing this part has increased a lot
  throughout the years but we haven't increased our price."
- Numbered options for a real problem (quality issue, complaint): state the
  issue's status, then lay out 1./2. concrete fixes, letting the customer
  choose.
- "kindly" does not appear in Eddie's own writing (only in incoming mail
  from overseas contacts) — don't put it in his voice.

## 3. Sign-off

Two sign-offs cover the large majority of business replies, roughly evenly:

- **"Best regards, / Eddie"** — the most common explicit sign-off (used in
  about a third of substantive replies). Default for this register.
- **"Eddie"** alone, or nothing at all — for a quick reply, especially one
  sent from the phone ("Sent from Eddie's iPhone" appended by the device,
  not typed by him).

"Warm regards," "Kind regards," or a long sign-off block (title, tagline,
socials) do not appear in his voice — "Best regards," is as formal as it
gets, and even that alternates freely with no sign-off at all inside the
same relationship depending on how quick the reply is.

## 4. High-frequency vocabulary & patterns

- Product name: **"Crystocraft"** — never "Crystal Craft", never expanded.
- Document delivery is a bare imperative with no preamble: "Please find the
  PI for the PO55162 attached.", "Please find the drawings for the phone
  accessories. Please see if this is ok.", "Please find the signed
  declaration. Thanks!"
- Status/tracking updates state the fact and hand over the proof directly:
  > "Dear Don, Thanks for your message. We shipped out the trophy on 9/28
  > and just now I checked the status it has arrived at the airport in US.
  > You can trace the status with this link: [tracking URL]. The tracking
  > number is: [number]. Best regards, Eddie"
- A standing outreach template exists for reconnecting with fair contacts —
  worth knowing verbatim since Daily Drafts do this exact job:
  > "Dear [Company], How are you? We have a new Crystocraft online
  > catalogue and you can create an account to see our latest items. Please
  > create an account from this link: https://portal.crystocraft.com and we
  > will grant access for you. Thanks! Best regards, Eddie Chou"
- A genuine quality complaint gets the issue stated factually, then
  concrete numbered options, no over-apologizing:
  > "Dear Claire, We are still testing the glue and will share result with
  > you once it is complete. The first solution is we can ship you some AB
  > glue and metal parts to do quick fix. But we need to test the AB glue
  > if there are strong enough to hold. The second solution is we can ship
  > the heart crystals with metal connectors with coming shipments..."
- Price/spec corrections are owned plainly, no defensiveness:
  > "Dear Harry, Sorry I noticed I messed up on the last excel file I sent
  > you on the model number, causing confusion. Please find this revised
  > one: ..."
- "Thanks for your message" / "Thanks for your patience" are the standard
  acknowledgement openers for a reply that took a while.

### 4a. Genuine crisis / complaint / bad-news register (targeted search)

A separate pass specifically hunted for angry-customer and complaint
language across all 375 customers' threads (not just Eddie's outbound
messages) to check whether the calm, factual tone above holds up under real
pressure. It does — three real examples:

- **Fraud alert (someone impersonating the company to steal a payment)** —
  the most urgent register found. Apology is one plain clause, then
  straight into the protective warning, no corporate hedging:
  > "Hi Yoshihara-San, I am terrible sorry this is a scam and not from our
  > company. Please ignore this and I will inform all our customers about
  > this."
  followed by:
  > "Please double check with the emails address, the scammer uses our
  > company name and names but the email address is not from us. Please pay
  > extra careful when you make payment. They may try to trick you by
  > asking you paying to a different bank account."
- **Product defect with a real fix, resolved well enough that the customer
  placed another order right after** — states the mechanism of the fix
  like an engineer, not a customer-service script:
  > "Hi Dawid, Just to update, we will add a spring to dampen the harmonics
  > like in the attached images in future production. The spring will
  > absorb some of the vibrations which create the scratching noises. We
  > will also put glue in the crystal holes to prevent them from shaking."
- **Delivering genuinely bad business news** (can no longer sustain a
  product line profitably) — explains the real underlying economics
  honestly instead of a vague brush-off, and still offers what help remains
  possible:
  > "Dear Michael, Thanks for your email. The economy has been difficult
  > these years and we have tried our very bests to find ways to sustain
  > the product line with flexible quantity with reasonable pricing.
  > However with the rising cost of labor and processes... most of the
  > products and parts we developed in the past is no longer competitive
  > nowadays... We do have some inventory and we can support you with the
  > current stock parts we have. However for freshly produce parts, we are
  > no longer be able to supply..."

**What this search did *not* find:** an example of a customer being
personally hostile toward Eddie and him having to de-escalate real anger
directed at him. Every "complaint-shaped" thread in this corpus turned out
to be a practical problem (a scam targeting a customer, a product defect, a
line becoming unsustainable) handled matter-of-factly — not a customer
shouting and Eddie calming them down. If a Daily Draft ever needs that
specific register, treat it as unverified rather than assume the pattern
above extends to it unchanged.

## 5. Anti-AI patterns — never use these in Eddie's voice

Absolutely avoid, even when generating a "polished" version:

- "I hope this email finds you well"
- "I would be delighted to..."
- "comprehensive solution" / "tailored solution" / "seamless experience"
- "Please do not hesitate to reach out"
- "Thank you for your patience and understanding" (he says "Thanks for your
  patience" — shorter, no "understanding" tacked on)
- "I wanted to circle back on..."
- "Looking forward to hearing from you!" (with exclamation-mark energy)
- Any triple-adjective stacking ("exciting, high-quality, premium")
- Corporate throat-clearing before the actual answer
- Long sign-off blocks (title, company tagline, socials) — his actual
  sign-off is "Best regards, Eddie", "Eddie", or nothing
- Over-apologizing for a real complaint (more than one short apology clause
  before getting to the fix)

## 6. Dos & Don'ts

**Do**
- Default to "Dear [First name]," for real business correspondence; use
  "Hi [First name]," for a more casual or already-warm relationship.
- Sign off "Best regards, Eddie" for a considered reply, "Eddie" or nothing
  for a quick one.
- State business facts plainly — prices, leadtimes, terms, tracking numbers
  — with no hedging.
- Apologize in one clause ("Sorry for the delay") then move straight to the
  substance.
- Give numbered concrete options for a real problem, and let the customer
  choose.
- Let a genuine personal aside sit right next to business content when the
  relationship warrants it — but keep it specific to what they said, never
  generic.
- Use "Please find [X] attached" as the default document-delivery opener.

**Don't**
- Don't open with "I hope this finds you well" or any weather/pleasantry.
- Don't stack adjectives or use "comprehensive," "seamless," "delighted."
- Don't add a long formal sign-off block.
- Don't over-apologize on a complaint — one clause, then the fix.
- Don't use "kindly" in Eddie's own voice.
- Don't default to "Hi" for a first-contact or formal business reply — this
  corpus favors "Dear" about 2:1 for that register.

## 7. Imitation examples — AI draft → Eddie's voice

**Example 1 — reconnect/catalogue outreach (the closest match to a Daily Draft)**

AI draft:
> Dear Valued Partner,
> We hope this message finds you well! We're thrilled to announce the
> launch of our brand-new comprehensive Crystocraft online catalogue,
> showcasing our exciting latest collection. We would be delighted if you
> could create an account to explore everything we have to offer. Please
> don't hesitate to reach out with any questions!
> Warm regards,
> The Crystocraft Team

Eddie's voice:
> Dear Gerald,
> How are you? We have a new Crystocraft online catalogue and you can
> create an account to see our latest items. Please create an account from
> this link: https://portal.crystocraft.com and we will grant access for
> you. Thanks!
> Best regards,
> Eddie Chou

**Example 2 — order status / tracking**

AI draft:
> Dear Customer,
> Thank you so much for your patience! We are pleased to inform you that
> your order has been successfully shipped and is now on its way to you.
> Please find the comprehensive tracking information below, and don't
> hesitate to reach out should you have any further questions!
> Best regards,
> The Crystocraft Team

Eddie's voice:
> Dear Don,
> Thanks for your message. We shipped out the trophy on 9/28 and just now I
> checked the status it has arrived at the airport in US.
> You can trace the status with this link: [tracking URL]
> The tracking number is: [number]
> Best regards,
> Eddie

**Example 3 — quality issue / complaint**

AI draft:
> Dear Valued Customer,
> We are so sorry to hear about the issue with your order! Please accept
> our sincerest apologies for any inconvenience this may have caused. Rest
> assured, our team is fully committed to resolving this matter and
> ensuring your complete satisfaction with a comprehensive solution as soon
> as possible!
> Warm regards,
> The Crystocraft Team

Eddie's voice:
> Dear Claire,
> We are still testing the glue and will share result with you once it is
> complete.
> The first solution is we can ship you some AB glue and metal parts to do
> quick fix. But we need to test the AB glue if there are strong enough to
> hold.
> The second solution is we can ship the heart crystals with metal
> connectors with coming shipments so that you can replace them for the
> pieces with problems.

**Example 4 — price/spec correction (owning a mistake)**

AI draft:
> Dear Harry,
> We sincerely apologize for any confusion caused by our previous
> correspondence regarding the model numbers in the Excel file. Please find
> attached a corrected and comprehensive version for your review, and we
> apologize once again for any inconvenience this may have caused!
> Best regards,
> The Crystocraft Team

Eddie's voice:
> Dear Harry,
> Sorry I noticed I messed up on the last excel file I sent you on the
> model number, causing confusion. Please find this revised one:
> D0092-001 is the peacock alternative to D0044
> D0332-001 is the single tulip, size is 2.75 x 5.5 cm (slightly taller
> than D0166-001). However we haven't put on the website. The price is same
> as D0166-001.
> Hope this clarifies.
> Best regards,
> Eddie

**Example 5 — urgent fraud/scam alert (the highest-stakes register found)**

AI draft:
> Dear Valued Customer,
> We regret to inform you that we have become aware of a fraudulent
> communication that may have been sent using our company name. We take
> matters of security extremely seriously and sincerely apologize for any
> concern this may have caused. Please rest assured that we are conducting
> a thorough investigation into this matter and will keep you updated with
> a comprehensive resolution.
> Warm regards,
> The Crystocraft Team

Eddie's voice:
> Hi Yoshihara-San,
> I am terrible sorry this is a scam and not from our company. Please
> ignore this and I will inform all our customers about this.
>
> Please double check with the emails address, the scammer uses our
> company name and names but the email address is not from us. Please pay
> extra careful when you make payment. They may try to trick you by asking
> you paying to a different bank account.

## 8. Source

**Primary source (this revision):** `eddie@uart.com.hk` sent mail, pulled
directly from the already-running IMAP sync (`email-sync/sync.py` +
`archive_import.py`, both already configured for this mailbox — see
`docs/skills/SOURCING-HUB.md`). Data was read read-only from the synced
Firestore `customers/*/email_threads` collections via a one-off script
(not committed — it just calls `email-sync/common.py`'s existing
`Firestore`/`sign_in` helpers and filters messages where `from` contains
`eddie@uart.com.hk`). 955 outbound messages found across 375 customers,
spanning 2018–2026; ~895 had a real body once quoted reply chains were
stripped. This is a much larger and more representative sample than the
20-ish `crystocraft@gmail.com` messages the previous revision of this doc
was built on, and — being the address the user says he actually replies to
customers from — the correct primary source going forward.

Coverage confirmed in this pass: cold/reconnect outreach, order status and
tracking, price and spec corrections, quality complaints and their
resolution, contract/negotiation language, PO and invoice handling, and
personal-register asides inside business threads.

A follow-up targeted pass specifically searched all 375 customers' full
thread text (both directions, not just Eddie's outbound) for angry/
complaint/dispute language (`disappoint`, `unacceptable`, `refund`,
`compensat`, `faulty`, `sue`, `lawyer`, `scam`, etc.) — 210 threads matched
at least one keyword, 64 matched a strong-signal one. The genuine
high-stakes threads found (a fraud alert, a product-defect resolution, a
line-becomes-unsustainable conversation — see §4a) confirm the same calm,
factual, one-clause-apology-then-substance tone holds under real pressure.
**Still not found:** a thread where a customer was personally hostile toward
Eddie and he had to de-escalate anger directed at him — every
complaint-shaped thread turned out to be a practical problem handled
matter-of-factly, not a shouting match. Treat that narrower register as
unverified if a Daily Draft ever needs it.

Excluded, same as before: `sales@uart.com.hk` (Angel Kwan's voice) and any
`crystocraft@gmail.com` message not unambiguously personal. Internal notes
to staff (Hero, Pinky, Philip, Cindy, Angel) are excluded from the *sample*
here too, even though `customers/*/email_threads` mixes in some CC'd
colleagues — only the substance of what Eddie himself wrote to the customer
was used.

Re-derive by re-running the same read-only pull against
`customers/*/email_threads`, filtering `from` for `eddie@uart.com.hk`, any
time a fresher or larger sample is wanted — the sync is live and ongoing, so
the corpus only grows.

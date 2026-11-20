# What the house measures

20 November 2026. Will's line: "If we don't track anything, we are idiots. If we track everything, we are creeps."
And: "We are not trying to sell data to advertisers. It's all internal, like we know who is in the house."
This page is the standard a change is checked against. The public promise is on /privacy and /promises; a change here
that touches either is Will's, with counsel reading the words. The lists below are drafts until Will confirms them.

## The house measures (inside the house, never sent out)

- Visits and paths: how many people came, where from, which rooms they used, where they left.
- The four funnels that say whether the house works: signing up to a first upload; a first upload to a first hang;
  opening a work to collecting it; a checkout started to a checkout paid.
- Speed and faults: how long each page took and what broke, by device.
- Each visitor's own looking (what they stood before, and for how long), kept to choose what to show them next and
  shown to them alone. This exists (`wm_v`, "your looking").

## The house never

- Sells, shares or trades anything about a visitor.
- Shows one person's looking to another person, a maker or a company. Makers see counts, never who.
- Follows a visitor to other sites, or lets an advertiser's cookie into the house.
- Records a screen in a private room, in checkout or in the Studio.
- Keeps anything about a child.
- Ranks people in public.

## How it is built

- Counting is the worker's. The website records a visit cheaply and never works out a figure while a visitor waits
  (docs/SCALE.md; the 502s of 18 and 20 Nov were ten counting questions asked on the website).
- Figures are kept as daily totals. The raw log of visits is kept only as long as /privacy says logs are kept.
- No outside analytics service runs in the house: /privacy says so. If a question arises that the house cannot answer
  itself, an outside tool is Will's decision, made openly: the privacy page changed with its date, the service named,
  nothing recorded in private rooms, do-not-track honoured, counsel reading the words first. (A PostHog account exists
  in Will's name, unused: no script, no data sent.)

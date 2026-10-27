# Watermark, the product

Draft, 27 October 2026. Will: "we built a product and it is a legitimate shipped product; we've done the MVP and now
every launch is adding on; we are getting this thing spun up like it's being created, and then we'll run it and
sharpen it."

## The sentence

Watermark 1.0 shipped on 27 October 2026, twelve days after the first commit. It is a museum you can collect from,
a library, a listening room, a press and a vault, run as one product by one house. Every release since adds a room
or keeps a promise; the record is at /releases.

## The build, and what changed on 27 October

16–27 October was the build: the MVP and a great deal more, shipped straight to the public address as it was made.
From 27 October the house is run as a product:

- **Releases, named and dated.** CHANGELOG.md is the record; /releases shows it; the footer carries the version.
  1.0 is the house as it opened. The second number moves when a room is added or a promise made (1.1, 1.2…); the
  third for repairs (1.0.1). The first number moves when the house changes shape (Postgres and the worker will be 2.0).
- **A development room.** `next` is where the work happens, every day, at the speed of the build. The public house
  takes a promotion once or twice a day, never during a showing, never while a chore runs there.
- **The gate, the walk and the watch.** Tests before any deploy; the doors opened after; the house asked every ten
  minutes; a failure emails the house.
- **The showing.** One switch before a demonstration; nothing moves while it is on.
- **One rule on the live house.** One heavy chore at a time, with /healthz open.

## The product team, as it stands

One founder and director, one builder (this session, every day), counsel by the hour, a lab, a print room. The roles
a product team will need as the house grows: an engineer who owns the database and the worker; a designer who owns
Wander; a registrar who owns what comes in; a host who owns the Keys. Until then the house's own rooms are the team's
tools: the desk, the numbers, the audit, the register.

## What 2.0 is

Postgres, a worker for the chores, a second origin behind the edge, watermark.com on the door. Zero-downtime deploys
and no single box. Built on `next`, proved on the test house, promoted once.

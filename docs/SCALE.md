# Scale: the house at any number

20 November 2026. Will's order: "build the mechanism to allow this site to run at any number… capable of 10 million
objects." The CTO session leads; workers take one issue each (docs/WORKERS.md, agents/NOTES.md). This page is the plan
and its proof. It is changed when a stage is proved, never before.

## Why the house stops today (measured in the code, 20 Nov)

- The website is one process with one thread. It asks Postgres through `src/pgsync.js`, which holds that thread until
  the answer comes (Atomics.wait). There are 3,796 such askings in 183 files.
- A question may hold the thread for DB_WAIT_MS: 20 seconds on the website. The watchdog ends a process that misses
  three answers of eight seconds. So one slow question is an outage for every visitor (13, 18 and 20 Nov).
- The live database is Render Postgres with 1 GB of memory.
- The scale gate (`scripts/big-house.js`) walks the house on SQLite. A room quick there is not shown quick on Postgres
  through the bridge; that is how the numbers desk passed the gate and stopped the house.

## The rule every stage serves

No visitor waits on another visitor's question. A page reads a bounded number of rows by an index, whatever the house
holds. Whatever walks the collection runs in the back room and leaves its answer for the website to read.

## The stages (each ends with a proof on Postgres, on the test house, before live)

| Stage | Holds | What changes | Proof |
|---|---|---|---|
| 0 Guard | today's 62,000 | Every website question limited to a few seconds, and a page that runs over says so; the numbers and the health made by the worker and only read by the website (#114, #115) | A test that asks a slow question and then loads the front page; Will opens the numbers desk on live |
| 1 Truth | 100,000 | The scale gate runs on Postgres through the bridge, as live does, at 100,000 and at 1,000,000 synthetic works; every room over budget is fixed or shut | CI job green at 100,000; the list of rooms that fail at 1,000,000 |
| 2 Many hands | 250,000 | The website asks without waiting (an async pool beside the bridge), first for the rooms strangers use: Wander, a work's page, Find, the hall, the collection. Several copies of the website run side by side | Load run: a slow desk open while 200 visitors wander, none delayed |
| 3 Million | 1,000,000 | Every public room on the async path; Find on its own index; the visit log and the register kept by month; every list paged by key | The gate at 1,000,000 on Postgres, every public room within budget |
| 4 Ten million | 10,000,000 | Read copies of the database; the edge answers most pages without the website; arrivals in bulk through a queue | The gate at 10,000,000 (records without pictures), and a costed storage plan |

A billion is not planned here. It is a different company's infrastructure and is decided when ten million is real.

## What costs money (for Will; every figure is an estimate until checked against the bill)

- The database: more memory is the cheapest speed there is. 1 GB is too small for what is asked of it now.
- The website: two or more copies from stage 2.
- The pictures: storage grows with every master kept. At ten million objects, whether the house keeps a master of
  every open-access museum picture or keeps the record and its display copies is the largest cost decision in the plan.
- The reading of each arrival by a model (the guide, the bag check): a cost per work, met by `src/spend.js`.
- The workers who build this: sessions on Will's plan.

## Lanes open now

- Guard: #115 (the limit), #114 (the numbers by the worker).
- Truth: the gate on Postgres.
- Many hands: the async path and its first rooms.

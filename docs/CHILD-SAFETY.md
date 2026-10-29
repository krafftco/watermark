# Child safety and accounts

*29 October 2026. Will: "we also need to screen and scan and make sure things aren't child pornography; we have to be super careful"; "make sure we don't get sued for anything like child or user accounts." A draft for Will and counsel.*

## What the house does today

| | |
|---|---|
| Al reads every arrival for recognisable people, a likely child, and nudity or a sexual picture (`attribute` in art.js) | built |
| A child read with nudity or a sexual picture, or a picture the reader refuses to read, is **quarantined at once**: out of every room, served to no one (the maker included), kept back, nothing deleted; the house written to with no picture in the letter | built (`src/safety.js`) |
| Adults read as unclothed go into the adult rooms (veiled for the default visitor and for children) unless the maker says otherwise | built |
| The safety desk (/studio/safety): the held works without pictures; one deliberate look, recorded; Reported (kept held, untouched) or Released (the reading was wrong) | built |
| Accounts are for adults: the doors that open a studio ask "I am eighteen or older"; the terms say it; collecting and curating likewise | built (/record, /join); the terms already said it |
| The kids' corner keeps no one: counted, never a visitor's id, referrer, device or country | built |
| No face recognition, anywhere (Illinois BIPA, Texas CUBI); no person is ever named by the house's AI | standing rule |

## What only Will (and counsel) can do

1. **Hash matching**, the industry's first line: apply for **Microsoft PhotoDNA** (free for qualified services) or **Thorn's Safer**. Either compares every upload against known abuse images before it is kept. The house's quarantine is ready to be called from it (`app.locals.safety.quarantine`).
2. **Register with NCMEC** as an electronic service provider so reports go through its CyberTipline (report.cybertip.org). US law (18 U.S.C. § 2258A) requires a provider to report apparent child sexual abuse material it knows of, and to preserve the report's contents (now a year).
3. **Counsel**: the reporting procedure, who at the house may look and decide, the retention, COPPA (the site is for adults; the kids' corner collects nothing), and the age line in the terms.

## The rule for anyone at the house

If a held work is, or may be, a sexual picture of a child: do not download, copy, forward or delete it. Report it to the CyberTipline, mark it Reported on the desk, tell counsel. If the reading was simply wrong (a work of art, a family beach), Release it with a word.

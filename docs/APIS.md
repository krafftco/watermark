# The sources the house reads, and the ones to add

Written 5 Nov 2026. A list of every outside source Watermark reads now and the ones worth adding next, ranked by what each one adds. The rule for every source is the same: the house reads the source's own rights statement for each item, keeps the source and credit on the record, and never suggests the source endorses the house. Anything marked *check* gets read again at the source before any code is written for it.

## Connected now

| Source | What it brings | Rights | Where in the code |
|---|---|---|---|
| The Met, Open Access API (v1.1) | ~500k objects, the CC0 highlights shown in the demo desk | CC0 for public-domain works | iiif.js `parseMet`, scout, lineup |
| Art Institute of Chicago API | Search, IIIF images | CC0 where `is_public_domain` | scout.js |
| Cleveland Museum of Art Open Access | Records and images | CC0 | scout.js |
| Smithsonian Open Access (api.si.edu) | 21 units, ~5M CC0 records | CC0 | feeds.js `siItems` (SI_API_KEY) |
| Wikimedia Commons | The museums that publish only there; whole artist trees | Rights read per file | feeds.js `commonsItems`, `commonsTree` |
| Wikidata (SPARQL + search) | The catalogue: every known work of an artist, its holder, its dates; owners and exhibitions for the registry | CC0 | catalogue.js, registry.js `history` |
| IIIF Presentation and Image APIs | Any museum that speaks IIIF, in and out | Rights read per item | iiif.js |
| OAI-PMH (Dublin Core) | Libraries and archives | Rights read per record | feeds.js `oaiPage` |
| Library of Congress (loc.gov JSON) | Free-to-use books and collections | Read per item | feeds.js kind `loc` |
| Internet Archive | Texts with their own OCR; the Great 78 Project; films | Read per item | documents.js `bringIA`, listening.js, screening.js |
| Project Gutenberg (and Gutendex) | The reading room's books, with pictures | Public domain in the US | reading.js, bookplates.js |
| Standard Ebooks (GitHub) | The finest public-domain editions | CC0 | standard.js |
| Copyright Office | No API yet; the house prepares the packet (1.55) | n/a | copyright.js |
| Stripe, Resend, ElevenLabs/OpenAI, Anthropic, Prodigi, AWS (S3, CloudFront), Dropbox | Money, mail, voice, Al, the lab, the vault, the edge, the inbox | Contracts | throughout |

## To add, in order

### 1. The canonical records of modern and contemporary art (no pictures, the record)
- **MoMA, collection dataset on GitHub.** ~160,000 works and ~16,000 artists as CSV/JSON. Fields: title, artist, dates, medium, dimensions, credit line, accession number, date acquired, department, classification, URL. Artists carry nationality, birth and death years, **Wikidata QID** and **Getty ULAN ID**. CC0. **Images are not included.** MoMA sends image licensing to Art Resource (North America) and Scala (elsewhere). MoMA's own API at api.moma.org is for staff and partners only.
  - Use 1: registry records "known to exist, in the collection of MoMA", with accession, credit line and date acquired. That is provenance's last line for the 20th century, where Wikidata is thin.
  - Use 2: the hall's catalogue for Picasso, Pollock, Matisse and others, shown as ghosts with "in copyright; see it at MoMA".
  - Use 3: the QID↔ULAN crosswalk for artists.
  - No pictures and no sales. The artists are mostly under copyright.
- **Tate collection (GitHub).** CC0 metadata, but the dataset is frozen around 2014 (*check*). Use it for the catalogue only.
- **National Gallery of Art, open data (GitHub).** Daily CSVs of objects, constituents, locations and image ids; CC0 images of public-domain works through IIIF (*check*). This one is a full reader: records and pictures.

### 2. Open pictures at museum quality
- **Rijksmuseum** (data services / Linked Art). Public-domain images at full resolution, CC0 (*check* the current API after their 2024–25 move to Linked Art).
- **Statens Museum for Kunst (SMK), Copenhagen.** An open API with CC0 images and IIIF.
- **Paris Musées.** 14 city museums, CC0 images, an API that needs a key.
- **Yale Center for British Art, and Yale's LUX.** Public domain, IIIF, Linked Art.
- **Getty Open Content and the Getty's Linked Art.** Public-domain images with no restrictions.
- **Europeana API** (key) and **DPLA API** (key). Aggregators of thousands of institutions. Rights are per item, so the house's `rightsKey` is what makes these usable.
- **Cooper Hewitt API** (key). Design objects, with mixed rights; fits the company and design rooms.
- Not for sale use: **Harvard Art Museums** (key), **V&A** and the **British Museum**. Their images are non-commercial. They can be shown with credit or linked, but never offered as prints.

### 3. Identity: one name for every artist, place and term
- **Getty ULAN** (artists), **AAT** (terms: media, techniques) and **TGN** (places), over SPARQL/Linked Art. This is how "oil on canvas", "Arles" and "Vincent van Gogh" become one thing across every museum.
- **VIAF** and **ISNI**, the library and rights world's identifiers. ISNI already sits on `makers.ids`.
- **Wikidata** stays the hub. MoMA, Getty and VIAF all carry QIDs.

### 4. Books, scores, sound and film
- **HathiTrust** (full-view public domain, bibliographic API), **Open Library** (covers, editions, identifiers) and **Biodiversity Heritage Library** (plates, CC0/PD).
- **Wikisource**, for transcribed texts with pages. **IMSLP**, for public-domain scores for the Listening Room's records (rights vary by country, *check*). **Musopen**, for CC0 recordings.
- **MusicBrainz**, for identifiers for every recording and work (CC0 core data).
- **Library of Congress National Screening Room** and **Prelinger Archives**, for public-domain film beyond Sunrise.

### 5. Rights and trust
- **rightsstatements.org** and **Creative Commons**, already read by `rightsKey`.
- **The C2PA trust list**, for whose camera and software signatures count (needed with C2PA_CERT).
- **ISCC** (ISO 24138), the content code for matching a work across platforms. A candidate beside the house's own fingerprint.
- **The Copyright Office.** Its public records system for looking up a registration, and the coming registration API (Docket 2026-3). The packet (1.55) is already in its shape.
- **PhotoDNA or Safer**, for child safety (Will's hands; docs/CHILD-SAFETY.md).

### 6. The market, by introduction only
- **Artnet / MutualArt / Artsy.** Auction results for the price record of physical works. These come by licence, never scraped, with counsel on appraisal lines.

## How a new source comes in
Each source is one reader in feeds.js or scout.js `READ` that yields the IIIF item shape (title, image, source, rights, meta), so it goes through the same door, bag check, register and per-item rights as everything else. Each source starts on the test house, takes one run of a few hundred, and gets read by eye before a full run. Only one heavy job runs on the live house at a time.

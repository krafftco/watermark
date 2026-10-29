# Where the work is made: Lightroom, Capture One, Leica, Adobe

*29 October 2026. Will: "whatever is best for artists and the world, and adoption from Leica and Lightroom"; "how can we someday integrate with Adobe and Capture One". A draft for Will.*

The rule under all of it: the house meets the maker where they already work, takes the file exactly as they made it, and asks them to type nothing twice. Open standards only (XMP, IPTC, C2PA), so no partner can switch us off.

## Built (1.8)

| | |
|---|---|
| **The record rides in.** Title, caption, keywords, place (city, sublocation) and stars that Lightroom, Capture One, Photo Mechanic or Leica FOTOS write into XMP/IPTC come in with the file. What the maker types in the vault wins; a reject (−1) arrives flagged; the file name is the last resort. | `images.saidOf` |
| **Lightroom Classic Publish Service.** `lightroom/watermark.lrplugin` (Lua, SDK 6+), served at `/lightroom/watermark.lrplugin.zip`; the page `/lightroom`. Signs in by the same code as the command line (a key held in Lightroom's password store, ended from /account/push). Sends full size, JPEG 100 or TIFF, all metadata, no output sharpening. Re-publishing an edited photograph makes it the master of the same work (`replaces` on the arrival → `app.locals.newEdit`; `work.edited` on the register); every earlier master stays in the vault under its own name. Removing from the collection never removes from the vault. | `test/lightroom.js` runs it under Lua 5.1 |
| **Capture One, today.** An Export Recipe into a folder, sent by `watermark push`. Its metadata rides in the file. | `/lightroom` |
| **Leica's signature.** A camera's Content Credentials are read through the chain on arrival and said on the work's page ("Signed at capture"); the master is never touched, so the signature stays whole. | 1.7.2 |

## Next, in order

1. **The Lightroom plug-in, signed and listed.** Test it on Will's Mac with his catalogue; then Adobe Exchange (free listing; Adobe reviews it). The plug-in's own Content Credentials export setting checked against a Leica file end to end.
2. **Capture One, watched.** `watermark push --watch <folder>`: a folder the command keeps an eye on, so an Export Recipe is a publish button. Capture One's plug-in SDK (Publishing plug-ins, C#/.NET) is the native door after that; it needs a developer account with Capture One.
3. **Lightroom (cloud) and mobile.** Adobe's Lightroom Partner APIs (developer.adobe.com/lightroom) read a maker's cloud catalogue with their consent (OAuth through Adobe; partner approval required). A "Connect Lightroom" door on the vault: choose an album, the house takes the originals or full-size renditions, keeps watching it.
4. **Leica, as a partner.** Leica FOTOS shares to an app on the phone; Wander installed as an app could receive a share (Web Share Target in the manifest) straight into the vault. Then the conversation with Leica (Will's): the house as where a Leica photograph is kept, licensed and sold with its signature intact; never claimed publicly until signed.
5. **The house signs too.** A C2PA certificate (Will's to buy) so every copy the house makes carries the house's signed credentials with the maker's original as its parent ingredient.
6. **Adobe Content Authenticity.** Adobe's Content Authenticity app lets a maker attach their identity and a "do not train" preference; the house reads both on arrival (they are C2PA assertions) and honours the second everywhere.

## What we never do

Rewrite a maker's metadata in their file; strip a camera's signature; ask for an Adobe or Capture One password; send anything of a maker's catalogue the maker did not choose.

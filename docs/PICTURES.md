# How the house shows a work

*29 October 2026. Will: "No one can complain about how our images get represented. If they put it in one way, that's them telling us that's the way they want it." And: "It has to work better than it's advertised."*

A draft standard for Will to confirm. Everything marked **holds** is in the code today and tested; everything marked **next** is not yet.

## The promise

The maker's file is the work. The house keeps it byte for byte and never improves it, corrects it, sharpens it, crops it or recolours it. Every copy the house makes is a faithful reduction of that file, and nothing more.

## The master

| | |
|---|---|
| Kept byte for byte, fingerprinted, deeded, in the vault | **holds** |
| A second copy in a mirror (another provider or region) | **next**: Will's switch in AWS |
| A full-size delivery (Collect's original, the Reference, an album, a seat) is the maker's own bytes with the papers added losslessly; never decoded, never re-encoded | **holds** |
| What the house asks for: the full-size export, JPEG at quality 100 with its colour profile, or TIFF / PNG; a DNG is kept as the negative beside its preview | **holds** |

## The copies the house makes

| | |
|---|---|
| Four sizes, made from the master, never from each other: thumb 600, screen 1600, large 2400, wall 3840 (long side), never enlarged past the original | **holds** |
| Lanczos resampling once; JPEG 92/94/94 at full chroma (4:4:4), WebP 92/94/94; the thumbnail at 80 | **holds** |
| Nothing laid into the pixels of any copy: no mark, no watermark, no sharpening, no "enhancement" | **holds** |
| The maker's colour kept: an sRGB master is shown in sRGB; a wider master (Display P3, Adobe RGB, ProPhoto) is shown in Display P3 with its profile attached, so wide-gamut screens show what was made and sRGB screens are colour-managed by the browser (it had been squeezed into sRGB until 29 Oct) | **holds** |
| Nothing private rides on a copy for the walls: no GPS, no serial numbers; only the house's copyright line | **holds** |
| Every copy made the moment a work arrives, kept-back work included, so the Library and the walls never wait on a 60 MP decode | **holds** |
| The gate: no change to how copies are made ships unless `test/pictures.js` passes (block structure, PSNR against the same resize, the colour kept, nothing private carried) | **holds** |
| A picture is never shown larger than its pixels allow (a quarter's grace, then the dark around it) | **holds** |
| The edge (CloudFront) holds a copy an hour and is told at once when a master changes | **holds** |

## How it is presented: the house's look

The Frick has a look: the room, the light, the frame, and then nothing between you and the picture. Ours, as it stands:

- **The dark wall.** Every work hangs on near-black (#0b0a09) in a pool of light, with a hairline edge. A pale picture is never set on white.
- **Nothing over the picture.** The plate (title, maker, place, year) rises beside or beneath it, holds for a few seconds and recedes. No badges, prices or counts sit on the image.
- **The whole picture.** Contain, never cover, in Wander and the viewer: a portrait is never cropped to fit a screen. (The grids' tiles still crop to a square: **next**, tiles in each work's own shape.)
- **Quiet acts.** Collect is one act among the rest, never a banner.
- **The margin of the dark.** On a computer the picture is fitted to 92% of the screen, so it reads as an object on a wall, not wallpaper.

## Next

1. **A soft-proof for the maker.** On the work's record, show the copy beside the master at the same size, in the master's colour, so the maker sees exactly what the house shows and signs it off.
2. **Ultra HDR / gain maps.** When a master carries HDR (an iPhone or a Lightroom HDR export), keep it on screens that can show it.
3. **AVIF** beside WebP once quality at equal size is proven by the gate.
4. **srcset on every plate**, so each screen fetches exactly the size it can show.
5. **The frame.** A choice of mount per work (none, the cotton mount, a thin black frame), chosen by the maker, never imposed.

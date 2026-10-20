# Arrivals: files straight into the vault

*20 Oct 2026. How large uploads work in Watermark, after the way Dropbox Transfer and ShootProof do it.*

The browser never sends a master through the house's server. It asks the house for a signed address for each part of the file (8 MB a part, four in flight), puts the parts straight into the vault's bucket, and tells the house when the last one has landed. The house completes the upload, and a queue takes the arrivals in one at a time in the background: the file is read, fingerprinted, matched by look to the work it was published as (and swapped in as its master), or registered privately in an archive room. Nothing decodes inside a request; a small server never runs out of room; a closed tab picks up where it stopped (the parts already up are remembered on that computer).

## The bucket's CORS rule (once, by Will)

The vault's bucket must allow the browser to put parts directly. In the bucket's settings (S3: Permissions → Cross-origin resource sharing; R2: Settings → CORS policy), add:

```json
[
  {
    "AllowedOrigins": ["https://watermark.krafftco.com"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

`ExposeHeaders: ETag` matters: the house completes a multipart upload from the ETags the browser collects, and without it the browser cannot read them and every file is reported 'no-etag'.

A test house on another address needs its own origin in `AllowedOrigins`.

## In code

- `src/arrivals.js`: the routes (`/studio/arrivals/start`, `/:id/urls`, `/:id/done`, `/:id/body` for a local vault, `/:id/abort`, `/:id/retry`, `/state`), the `arrivals` table and the queue (`pump`).
- `src/storage.js`: `multipart` (start, partUrl, complete, abort) and `download` on the S3 store.
- `public/arrivals.js`: the Masters desk's uploader.
- `takeMaster` in `src/app.js`: one file into the house, shared with the one-request desk.
- `src/guardrails.js`: the CSP's `connect-src` allows the bucket's host.

## Next

- Makers' own vault (/account/upload) through the same door, with the arrival credited to the maker.
- The house pulling from a watched folder (Dropbox) so the computer can sleep.
- A desktop uploader or a Lightroom publish plugin, as ShootProof has.

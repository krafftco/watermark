#!/usr/bin/env node
'use strict';
// The edge's "one moment" page (#149, layer 1). When the website does not answer, the edge (CloudFront) shows this page
// from the vault's bucket, not from the website, which is the thing that is down. The page is built from src/breaks.js
// (its words are COPY there) and is one self-contained file: no font, style or script is asked of the house.
//
//   node scripts/edge-page.js                 writes the page to ./one-moment.html and says what it would upload; nothing is sent
//   node scripts/edge-page.js --out <file>    writes it there instead
//   node scripts/edge-page.js --put           uploads it to s3://$S3_BUCKET/edge/one-moment.html (the vault's bucket)
//
// --put reads the bucket and region from the environment as the house does (S3_BUCKET, AWS_REGION, S3_ENDPOINT) and the
// key from the AWS SDK's own chain (the environment, a profile). It is Will's to run, once now and after each change to
// the words, followed by an invalidation of /edge/* on the distribution. No worker runs it against live.
const fs = require('fs'); const path = require('path');
const { momentPage } = require('../src/breaks');

const args = process.argv.slice(2);
const flag = n => args.includes(n);
const val = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const KEY = val('--key') || 'edge/one-moment.html';
const html = momentPage();

(async () => {
  const out = val('--out') || path.join(process.cwd(), 'one-moment.html');
  fs.writeFileSync(out, html);
  console.log(`the page: ${out} (${html.length} bytes; open it in a browser to read it)`);
  if (!flag('--put')) {
    console.log(`not sent. With --put it would be written to s3://${process.env.S3_BUCKET || '<S3_BUCKET>'}/${KEY} as text/html, Cache-Control public, max-age=300.`);
    return;
  }
  const bucket = process.env.S3_BUCKET; if (!bucket) { console.error('S3_BUCKET is not set; nothing was sent.'); process.exit(1); }
  if (/\b(require|import)\b|https?:\/\/(?!www\.w3\.org)/.test(html.replace(/<script>[\s\S]*?<\/script>/, ''))) { console.error('the page asks something of another address; refusing to send it.'); process.exit(1); }
  const S3 = require('@aws-sdk/client-s3');
  const endpoint = process.env.S3_ENDPOINT;
  const c = new S3.S3Client({ region: process.env.AWS_REGION || 'us-east-1', ...(endpoint ? { endpoint, forcePathStyle: true } : {}) });
  const sse = (endpoint && /r2\.cloudflarestorage/.test(endpoint)) || process.env.S3_NO_SSE === '1' ? {} : { ServerSideEncryption: 'AES256' };
  await c.send(new S3.PutObjectCommand({ Bucket: bucket, Key: KEY, Body: Buffer.from(html), ContentType: 'text/html; charset=utf-8', CacheControl: 'public, max-age=300', ...sse }));
  const back = await c.send(new S3.HeadObjectCommand({ Bucket: bucket, Key: KEY }));
  console.log(`sent: s3://${bucket}/${KEY} (${back.ContentLength} bytes, ${back.ContentType}). Now invalidate /edge/* on the distribution.`);
})().catch(e => { console.error('not sent:', e.name || '', e.message); process.exit(1); });

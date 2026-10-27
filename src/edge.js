// The edge (25 Oct): CloudFront in front of the house holds /img and /static for an hour. When a picture changes
// (a new master, a rebuild in the restoration room) the edge is told to drop its copies at once, so no one sees
// the old picture for the rest of the hour. Needs CLOUDFRONT_DISTRIBUTION (e.g. EUW7MFQLDRUTK) and a key allowed
// cloudfront:CreateInvalidation (the vault's key, if Will grants it); without them the hour simply applies.
let client = null;
function on() { return !!process.env.CLOUDFRONT_DISTRIBUTION; }
async function invalidate(paths) {
  if (!on() || !paths.length) return null;
  try {
    const { CloudFrontClient, CreateInvalidationCommand } = require('@aws-sdk/client-cloudfront');
    // The edge's own key (27 Oct): the vault's bucket lives in one AWS account and the distribution in another, so the
    // edge may carry its own scoped credentials (CLOUDFRONT_ACCESS_KEY_ID/SECRET, a user allowed only CreateInvalidation on
    // this distribution); without them the default chain (the vault's AWS_ACCESS_KEY_ID) is tried as before.
    const ak = process.env.CLOUDFRONT_ACCESS_KEY_ID, sk = process.env.CLOUDFRONT_SECRET_ACCESS_KEY;
    client = client || new CloudFrontClient({ region: 'us-east-1', ...(ak && sk ? { credentials: { accessKeyId: ak, secretAccessKey: sk } } : {}) });
    const r = await client.send(new CreateInvalidationCommand({ DistributionId: process.env.CLOUDFRONT_DISTRIBUTION, InvalidationBatch: { CallerReference: `wm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, Paths: { Quantity: paths.length, Items: paths } } }));
    return r.Invalidation && r.Invalidation.Id;
  } catch (e) { console.error('[edge]', e.name || '', e.message); return null; }
}
const work = slug => invalidate([`/img/${slug}/*`]);
const all = () => invalidate(['/img/*', '/static/*']);
// Every page (27 Oct): the edge had held the cold page for twenty-five minutes after the house was back (Age 1500 s on a 503),
// so a recovered house still looked down. Once the house is up and sound it tells the edge to drop everything it holds.
const everything = () => invalidate(['/*']);
module.exports = { on, invalidate, work, all, everything };

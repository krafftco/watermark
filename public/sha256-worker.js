// The fingerprint the browser takes of a file before it leaves the computer (29 Oct, Will: "we never can mess up"):
// SHA-256 of the whole file, read in slices so a 2 GB master never sits in memory, in a worker so the page never
// stutters. The house takes the same fingerprint of the bytes that arrived and keeps a file only when the two match.
// Plain SHA-256 (FIPS 180-4); WebCrypto's digest wants the whole file at once, so the rounds are written here.
var K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
function Sha256() { this.h = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]); this.w = new Int32Array(64); this.buf = new Uint8Array(64); this.n = 0; this.len = 0; }
Sha256.prototype.block = function (d, o) {
  var w = this.w, h = this.h, i, t1, t2, a = h[0], b = h[1], c = h[2], e, f, g, hh, dd = h[3];
  for (i = 0; i < 16; i++) w[i] = (d[o + i * 4] << 24) | (d[o + i * 4 + 1] << 16) | (d[o + i * 4 + 2] << 8) | d[o + i * 4 + 3];
  for (i = 16; i < 64; i++) { var x = w[i - 15], y = w[i - 2]; w[i] = (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w[i - 7] + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)) + w[i - 16] | 0; }
  e = h[4]; f = h[5]; g = h[6]; hh = h[7];
  for (i = 0; i < 64; i++) {
    t1 = hh + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + w[i] | 0;
    t2 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c)) | 0;
    hh = g; g = f; f = e; e = dd + t1 | 0; dd = c; c = b; b = a; a = t1 + t2 | 0;
  }
  h[0] = h[0] + a | 0; h[1] = h[1] + b | 0; h[2] = h[2] + c | 0; h[3] = h[3] + dd | 0; h[4] = h[4] + e | 0; h[5] = h[5] + f | 0; h[6] = h[6] + g | 0; h[7] = h[7] + hh | 0;
};
Sha256.prototype.update = function (d) {
  var i = 0, L = d.length; this.len += L;
  if (this.n) { while (this.n < 64 && i < L) this.buf[this.n++] = d[i++]; if (this.n === 64) { this.block(this.buf, 0); this.n = 0; } }
  for (; i + 64 <= L; i += 64) this.block(d, i);
  while (i < L) this.buf[this.n++] = d[i++];
};
Sha256.prototype.hex = function () {
  var bits = this.len * 8, pad = new Uint8Array((this.n < 56 ? 56 : 120) - this.n + 8); pad[0] = 0x80;
  var hi = Math.floor(bits / 4294967296), lo = bits >>> 0, e = pad.length;
  pad[e - 8] = hi >>> 24; pad[e - 7] = hi >>> 16; pad[e - 6] = hi >>> 8; pad[e - 5] = hi; pad[e - 4] = lo >>> 24; pad[e - 3] = lo >>> 16; pad[e - 2] = lo >>> 8; pad[e - 1] = lo;
  this.update(pad); var s = ''; for (var j = 0; j < 8; j++) s += ('00000000' + (this.h[j] >>> 0).toString(16)).slice(-8); return s;
};
var SLICE = 4 * 1024 * 1024;
async function digest(file, id) {
  var s = new Sha256(), at = 0, last = 0;
  while (at < file.size) {
    var buf = new Uint8Array(await file.slice(at, Math.min(file.size, at + SLICE)).arrayBuffer());
    s.update(buf); at += buf.length;
    if (at - last > 32 * 1024 * 1024) { last = at; postMessage({ id: id, read: at }); }
  }
  return s.hex();
}
if (typeof self !== 'undefined' && typeof self.addEventListener === 'function' && typeof module === 'undefined') {
  self.onmessage = function (e) { var m = e.data; digest(m.file, m.id).then(function (hex) { postMessage({ id: m.id, sha256: hex }); }, function (err) { postMessage({ id: m.id, error: String(err && err.message || err) }); }); };
}
if (typeof module !== 'undefined') module.exports = { Sha256: Sha256 };

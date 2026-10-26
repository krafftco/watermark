// The ornaments (Will, 26 Oct: "beautiful graphics and heads for our books"): the printer's flowers of a fine
// press edition, drawn by the house. A headpiece above every chapter head, a tailpiece where the chapter ends,
// chosen for the book by the same hash that picks its leather, so one book is set in one family of ornaments from
// cover to colophon. Line drawings in the ink of the page (currentColor), so they sit on paper, sepia or night.
'use strict';

const hashOf = s => { let h = 2166136261; for (const c of String(s || '')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

// Six families: each a headpiece (a band 240 × 28) and a tailpiece (a sprig 60 × 36).
const FAMILIES = [
  { name: 'vine', head: `<path d="M20 14c20-10 40 10 60 0s40-10 60 0 40 10 60 0 40-10 60 0" fill="none" stroke="currentColor" stroke-width="1.1"/><g fill="currentColor"><circle cx="20" cy="14" r="1.6"/><circle cx="80" cy="14" r="1.6"/><circle cx="140" cy="14" r="1.6"/><circle cx="200" cy="14" r="1.6"/><circle cx="260" cy="14" r="1.6"/><circle cx="120" cy="6" r="1.2"/><circle cx="120" cy="22" r="1.2"/></g>`,
    tail: `<path d="M30 4c0 12-6 20-14 26M30 4c0 12 6 20 14 26M30 4v30" fill="none" stroke="currentColor" stroke-width="1.1"/><g fill="currentColor"><circle cx="16" cy="30" r="1.6"/><circle cx="44" cy="30" r="1.6"/><circle cx="30" cy="4" r="1.8"/></g>` },
  { name: 'rule', head: `<path d="M20 14h88M132 14h88" stroke="currentColor" stroke-width="1"/><path d="M120 7l5 7-5 7-5-7z" fill="currentColor"/><circle cx="20" cy="14" r="1.5" fill="currentColor"/><circle cx="220" cy="14" r="1.5" fill="currentColor"/>`,
    tail: `<path d="M30 10l6 8-6 8-6-8z" fill="currentColor"/><path d="M8 18h12M40 18h12" stroke="currentColor" stroke-width="1"/>` },
  { name: 'fleuron', head: `<path d="M20 14h70M150 14h70" stroke="currentColor" stroke-width="1"/><path d="M120 5c-5 4-8 9-8 14 4-1 7-4 8-7 1 3 4 6 8 7 0-5-3-10-8-14z" fill="currentColor"/><path d="M104 14c4-3 8-3 12 0M124 14c4-3 8-3 12 0" fill="none" stroke="currentColor" stroke-width="1"/>`,
    tail: `<path d="M30 6c-6 5-10 11-10 18 5-1 9-5 10-9 1 4 5 8 10 9 0-7-4-13-10-18z" fill="currentColor"/><path d="M14 30c5-4 11-4 16 0M30 30c5-4 11-4 16 0" fill="none" stroke="currentColor" stroke-width="1"/>` },
  { name: 'laurel', head: `<path d="M20 14h60M160 14h60" stroke="currentColor" stroke-width="1"/><g fill="none" stroke="currentColor" stroke-width="1"><path d="M94 20c4-10 12-14 26-14-4 10-12 14-26 14z"/><path d="M146 20c-4-10-12-14-26-14 4 10 12 14 26 14z"/><path d="M94 20c8-4 16-7 26-8M146 20c-8-4-16-7-26-8"/></g><circle cx="120" cy="20" r="1.8" fill="currentColor"/>`,
    tail: `<g fill="none" stroke="currentColor" stroke-width="1"><path d="M6 30c6-14 14-20 24-22-4 12-12 18-24 22z"/><path d="M54 30c-6-14-14-20-24-22 4 12 12 18 24 22z"/></g><circle cx="30" cy="30" r="1.8" fill="currentColor"/>` },
  { name: 'stars', head: `<path d="M20 14h76M144 14h76" stroke="currentColor" stroke-width="1"/><g fill="currentColor"><path d="M120 6l2.2 5.4 5.8.5-4.4 3.8 1.3 5.7-4.9-3-4.9 3 1.3-5.7-4.4-3.8 5.8-.5z"/><circle cx="104" cy="14" r="1.4"/><circle cx="136" cy="14" r="1.4"/></g>`,
    tail: `<g fill="currentColor"><path d="M30 8l2.6 6.4 6.9.6-5.2 4.5 1.6 6.8-5.9-3.6-5.9 3.6 1.6-6.8-5.2-4.5 6.9-.6z"/><circle cx="12" cy="20" r="1.4"/><circle cx="48" cy="20" r="1.4"/></g>` },
  { name: 'wave', head: `<path d="M20 14h64M156 14h64" stroke="currentColor" stroke-width="1"/><path d="M92 14c4-5 8-5 12 0s8 5 12 0 8-5 12 0 8 5 12 0 8-5 12 0" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`,
    tail: `<path d="M8 18c4-6 8-6 12 0s8 6 12 0 8-6 12 0 8 6 12 0" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="30" cy="30" r="1.5" fill="currentColor"/>` },
];
const family = t => FAMILIES[(hashOf((t && (t.slug || t.title)) || '') >>> 3) % FAMILIES.length];
const headpiece = t => `<svg class="rdr-hp" viewBox="0 0 240 28" width="240" height="28" aria-hidden="true" focusable="false">${family(t).head}</svg>`;
const tailpiece = t => `<svg class="rdr-tp" viewBox="0 0 60 36" width="60" height="36" aria-hidden="true" focusable="false">${family(t).tail}</svg>`;

module.exports = { headpiece, tailpiece, family, FAMILIES };

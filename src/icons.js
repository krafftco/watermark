// The house's glyphs: one family, drawn by hand on a 24-point grid, a 1.5-point line, round ends. No filled blobs,
// no emoji. Each reads at 18 px on a dark wall and at 24 px on paper. Use them with a word beside them wherever
// the act is not obvious; the glyph alone only where the word has already been said.
const wrap = (d, extra = '') => `<svg class="ic${extra ? ' ' + extra : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const I = {
  // A top hat, tipped: the tip of the hat.
  hat: wrap('<g transform="rotate(-12 12 13)"><path d="M7.6 16.2V6.4c0-1.1 2-1.9 4.4-1.9s4.4.8 4.4 1.9v9.8"/><path d="M7.6 10.4c1.2.7 2.7 1.1 4.4 1.1s3.2-.4 4.4-1.1"/><path d="M2.6 15.6c2.2 1.8 5.6 2.8 9.4 2.8s7.2-1 9.4-2.8"/><path d="M2.6 15.6c.8-.8 1.9-1.3 3.2-1.5M21.4 15.6c-.8-.8-1.9-1.3-3.2-1.5"/></g>'),
  // A frame hung from a nail by its cord.
  hang: wrap('<circle cx="12" cy="4.2" r="1"/><path d="M12 5.2 7.2 9.6M12 5.2l4.8 4.4"/><rect x="4.8" y="9.6" width="14.4" height="10.4"/><rect x="7.6" y="12.2" width="8.8" height="5.2"/>'),
  // The seal: the wave inside a ring. Collect.
  collect: wrap('<circle cx="12" cy="12" r="8.6"/><path d="M7.2 12.7c1.2-1.5 2.4-1.5 3.6 0s2.4 1.5 3.6 0 2.4-1.5 3.6 0"/>'),
  // The photograph itself.
  page: wrap('<rect x="3.8" y="5" width="16.4" height="14"/><path d="M3.8 15.4l4.6-4.6 4.2 4.2 2.6-2.6 5 5"/><circle cx="15.4" cy="9.2" r="1.3"/>'),
  // The guide, read aloud: an open book.
  guide: wrap('<path d="M12 6.6C10.4 5.4 8.2 5 5 5.1v12.6c3.2-.1 5.4.3 7 1.5 1.6-1.2 3.8-1.6 7-1.5V5.1c-3.2-.1-5.4.3-7 1.5z"/><path d="M12 6.6v12.6"/>'),
  // Standing before a photograph: a figure.
  stand: wrap('<circle cx="12" cy="5.4" r="2"/><path d="M12 7.4v8.2M8.6 20.2 12 15.6l3.4 4.6M7.8 10.6l4.2-1.4 4.2 1.4"/>'),
  // A trade: one for another.
  trade: wrap('<path d="M4 8.8h13.4l-3.2-3.2M20 15.2H6.6l3.2 3.2"/>'),
  // Sent on: a letter.
  send: wrap('<rect x="3.6" y="6" width="16.8" height="12" rx="1"/><path d="m3.6 7.2 8.4 6 8.4-6"/>'),
  // A thank-you card: a card with the wave.
  card: wrap('<rect x="4" y="6.4" width="16" height="11.2" rx="1"/><path d="M7.6 12.2c1-1.2 1.9-1.2 2.9 0s1.9 1.2 2.9 0 1.9-1.2 2.9 0"/><path d="M7.6 15h5.2"/>'),
  // Back, next.
  back: wrap('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  next: wrap('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  // Pause and wander on.
  pause: wrap('<path d="M9 6v12M15 6v12"/>'),
  play: wrap('<path d="M8 5.6v12.8L18.4 12z"/>'),
  // The full purview, and out of it.
  full: wrap('<path d="M4 9.2V4h5.2M14.8 4H20v5.2M20 14.8V20h-5.2M9.2 20H4v-5.2"/>'),
  close: wrap('<path d="M6 6l12 12M18 6 6 18"/>'),
  // The wave alone, for Wander: the house's line, walking.
  wave: '<svg class="ic ic-wave" viewBox="0 0 28 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M1.5 6c2-3 4-3 6 0s4 3 6 0 4-3 6 0 4 3 6 0"/></svg>',
  // Keys and the eye.
  key: wrap('<circle cx="8" cy="12" r="3.6"/><path d="M11.6 12H20m-2.6 0v3M15 12v2.2"/>'),
  eye: wrap('<path d="M2.6 12c2.4-4 5.6-6 9.4-6s7 2 9.4 6c-2.4 4-5.6 6-9.4 6s-7-2-9.4-6z"/><circle cx="12" cy="12" r="2.8"/>'),
  // Put in, take out.
  in: wrap('<path d="M12 4v11M7.6 10.6 12 15l4.4-4.4"/><path d="M4.5 16.5v2a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2"/>'),
  out: wrap('<path d="M12 15V4M7.6 8.4 12 4l4.4 4.4"/><path d="M4.5 16.5v2a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2"/>'),
  // Arrange: the drag handle.
  grip: wrap('<circle cx="9" cy="6" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.1" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.1" fill="currentColor" stroke="none"/>'),
  plus: wrap('<path d="M12 5v14M5 12h14"/>'),
  check: wrap('<path d="m5 12.5 4.2 4.2L19 7.4"/>'),
};
module.exports = I;

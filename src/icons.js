// The house's glyphs: one family, drawn by hand on a 24-point grid, a 1.5-point line, round ends. No filled blobs,
// no emoji. Each reads at 18 px on a dark wall and at 24 px on paper. Use them with a word beside them wherever
// the act is not obvious; the glyph alone only where the word has already been said.
const wrap = (d, extra = '') => `<svg class="ic${extra ? ' ' + extra : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const I = {
  // A top hat, tipped: the tip of the hat.
  // Bravo (Will, 18 Oct: an iconic gesture, a little opera man, the hat's companion): a gentleman in tails, arms up,
  // throwing his top hat in the air. The hat is a nod; this is hats in the air.
  bravo: `<svg class="ic" viewBox="3 1 19 21.4" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g transform="rotate(-18 17.2 3.6)"><path d="M14.8 5.1h4.8M15.6 5.1V2.1h3.2v3"/></g><circle cx="11.2" cy="9.9" r="2.3"/><path d="M9.8 12.9c.9-.3 1.9-.3 2.8 0l-.1 4H9.9z"/><path d="M9.9 15.2l-1.4 3.9M12.5 15.2l1.4 3.9"/><path d="M10.6 16.9v4.7M11.8 16.9v4.7"/><path d="M9.9 13.4L6.6 8.6M12.5 13.4l2.4-4.9"/></svg>`,
  hat: wrap('<g transform="rotate(-12 12 13)"><path d="M7.6 16.2V6.4c0-1.1 2-1.9 4.4-1.9s4.4.8 4.4 1.9v9.8"/><path d="M7.6 10.4c1.2.7 2.7 1.1 4.4 1.1s3.2-.4 4.4-1.1"/><path d="M2.6 15.6c2.2 1.8 5.6 2.8 9.4 2.8s7.2-1 9.4-2.8"/><path d="M2.6 15.6c.8-.8 1.9-1.3 3.2-1.5M21.4 15.6c-.8-.8-1.9-1.3-3.2-1.5"/></g>'),
  // A frame hung from a nail by its cord.
  hang: wrap('<circle cx="12" cy="4.2" r="1"/><path d="M12 5.2 7.2 9.6M12 5.2l4.8 4.4"/><rect x="4.8" y="9.6" width="14.4" height="10.4"/><rect x="7.6" y="12.2" width="8.8" height="5.2"/>'),
  // The seal: the wave inside a ring. Collect.
  // Collect: the Watermark wave itself (the logo's own path) inside the ring, drawn to the ring's weight (Will, 18 Oct: water, and the house's own mark).
  collect: wrap('<circle cx="12" cy="12" r="8.6" stroke-width="1.3"/><path fill="currentColor" stroke-width="1.4" transform="translate(12 12) scale(.3293) translate(-22 -19.73)" d="M40.9019,20.248c.0496.0348.1284.1018.21.14.0392.0183.1355.0555.1748.0725.142.0613.2106.0623.2106.0623.4242.1069.61-.0405.61-.0405,0,0,.0188-.0104.0372-.0243.0184-.014.0363-.0314.0458-.0406.0151-.0146.0539-.0644.0539-.0644,0,0,.052-.0909.0637-.1237.0071-.0198.024-.0795.024-.0795.0222-.0965.0109-.1126.0246-.2317.0093-.0811-.0287-.3268-.0598-.4078-.0365-.0952-.1166-.3107-.1703-.4046-.0609-.1065-.288-.3048-.3726-.4039-.0684-.0801-.1447-.1568-.2296-.2285-.1278-.108-.4529-.423-.699-.5881-.1149-.077-.4531-.3086-.661-.3576-.1954-.0461-.5058-.1799-.7093-.2207-.1562-.0313-.3892-.0664-.5873-.0663-.1141.0029-1.5885.0597-2.7094,1.0659-.3753.3369-.3855.3946-.8039.8574-1.32,1.4605-2.8991,1.493-4.248.0839-2.6425-2.7603-4.3029-2.7712-7.0126-.0458-1.4491,1.4575-2.8945,1.5826-4.2166-.0527-2.0205-2.4992-5.04-2.4249-6.9906-.0205-1.4506,1.788-2.9277,1.5387-4.6146-.3402-1.5584-1.7356-3.6345-2.0457-5.3761-.7779-.3208.2335-.6042.5574-.9828.9127-.3769.3368-.7879,2.0455.8259,1.4273.2077-.0796.4772-.3289.6437-.4599,1.37-1.0769,2.6549-.9274,3.9243.3511,2.7283,2.7477,4.1663,2.7285,6.9293-.0031,1.449-1.4325,2.9109-1.5845,4.2323.0157,2.0744,2.512,4.8342,2.5441,6.9759.0433,1.4851-1.7342,2.9311-1.5102,4.6445.3102,1.7438,1.8528,3.6846,2.1267,5.4476.7528.2651-.2066.5093-.4648.7507-.7199.9751-1.0303,1.776-1.4668,2.6072-1.416,0-.052.6333.1119.8306.2146.0961.05.3577.1959.4835.268.0829.0476.2447.1927.3365.2464l.1702.1427.1157.0958.071.0558Z"/>'),
  // The photograph itself.
  print: wrap('<rect x="5" y="3.5" width="14" height="17"/><rect x="7.6" y="6.2" width="8.8" height="7.4"/><path d="M7.6 16.6h5.2"/>'),
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
  // The wanderer: a figure mid-stride, for Wander.
  wander: wrap('<circle cx="13.6" cy="4.4" r="1.9"/><path d="M12.7 7.6 11.2 13M12.4 8.6 9.2 11.4M12.4 8.6l3.4 2.2 1.4 2.6M11.2 13l3.2 3.2.8 4.4M11.2 13l-2.8 3.6-1.2 4"/>'),
  // Keys and the eye.
  key: wrap('<circle cx="8" cy="12" r="3.6"/><path d="M11.6 12H20m-2.6 0v3M15 12v2.2"/>'),
  // A glass: find.
  find: wrap('<circle cx="10.6" cy="10.6" r="6"/><path d="m15 15 5.4 5.4"/>'),
  eye: wrap('<path d="M2.6 12c2.4-4 5.6-6 9.4-6s7 2 9.4 6c-2.4 4-5.6 6-9.4 6s-7-2-9.4-6z"/><circle cx="12" cy="12" r="2.8"/>'),
  // Put in, take out.
  in: wrap('<path d="M12 4v11M7.6 10.6 12 15l4.4-4.4"/><path d="M4.5 16.5v2a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2"/>'),
  out: wrap('<path d="M12 15V4M7.6 8.4 12 4l4.4 4.4"/><path d="M4.5 16.5v2a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2"/>'),
  // Arrange: the drag handle.
  grip: wrap('<circle cx="9" cy="6" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.1" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.1" fill="currentColor" stroke="none"/>'),
  plus: wrap('<path d="M12 5v14M5 12h14"/>'),
  check: wrap('<path d="m5 12.5 4.2 4.2L19 7.4"/>'),
};
// The bell: a handbell, not an alarm.
I.bell = wrap('<path d="M6.6 16.4V11a5.4 5.4 0 0 1 10.8 0v5.4l1.4 1.8H5.2z"/><path d="M10.2 20.2a1.9 1.9 0 0 0 3.6 0"/><path d="M12 5.6V4.2"/>');
module.exports = I;

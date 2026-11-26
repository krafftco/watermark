'use strict';
// Collect, retired as a new offer (#208; Will, 22 Nov: a few-dollar "Collect" beside a photograph "changes the
// perceived value of the photo. Think Gagosian." and "Find a way to be transparent but not cheap."). Prices are open,
// but they sit on the label, never on or over the picture, and the least a visitor can buy is a real object.
//   COLLECT=on (Render's environment) brings the old offer back exactly as it was: the Collect ('social') and the
//   Reference ('reference', the $25 full original, also a Collect) are offered again wherever they were, and the
//   pages show them as before. Unset or anything else: off. The code stays; only the offer is closed.
//   Off closes both keys in listed()/offered() (src/app.js), which closes the work page's seal, /buy, /license,
//   Wander's Collect, the express doors, the basket, series and frame sets, the stand's price and the looking letter.
//   What is already held is untouched: licences, papers, the register, the holder's room, downloads, resale on the
//   market (which lists only pieces already held, and issues none). A standing order already running keeps its picks
//   (the collector pays for them); a new one cannot begin.
const KEYS = new Set(['social', 'reference']);
const on = () => /^(on|1|true|yes)$/i.test(String(process.env.COLLECT || '').trim());
const closed = key => KEYS.has(key) && !on();
module.exports = { on, closed, KEYS };

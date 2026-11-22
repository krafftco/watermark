// The contract: Watermark Ventures' Standard Content License Agreement, drafted with counsel (2020–21),
// assembled clause by clause from what the licensee actually paid for. Each permitted use is a right
// that is either in the contract or not; extended rights (merchandise, derivative works, more than one
// company, exclusivity) open or close the clauses they govern; the maker's "never" list is written in as
// restrictions. Same pattern as the 2021 license generator (permitted-use switches, merchandise lifting
// restriction (g)), carried into Watermark v0.
//
// Text: counsel's draft, verbatim except where marked FIX (obvious drafting slips) or ADDED (Watermark v0
// additions: term, exclusivity, the maker's restrictions, AI training, Content Credentials). Every FIX and
// ADDED item is listed in REVIEW for counsel. Prices for added rights are drafts until Will confirms.
//
// (#183; Will, 21 Nov 2026) Two more things an order can carry, in the same pattern: where the work may be used
// (worldwide unless a territory is named) and how much (unlimited unless a number is stated). Each only narrows:
// a named territory or a stated size adds its own clause to Section 2 and changes nothing else; an order without
// them is assembled exactly as before (test/licence-by-use.js holds today's text to its fingerprints). Neither
// has a price: a narrower license is asked of the maker. The wording is a first draft for counsel (REVIEW).

// The nine permitted uses from counsel's clause 2.1, in its order.
const RIGHTS = [
  ['websites', 'Websites', 'websites'],
  ['social', 'Social media', 'social media'],
  ['marketing', 'Marketing materials', 'marketing materials'],
  ['presentations', 'Presentations', 'presentations'],
  ['educational', 'Educational works', 'educational works'],
  ['editorial', 'Editorial works', 'editorial works'],
  ['audiovisual', 'Audiovisual works', 'audiovisual works'],
  ['literary', 'Literary works', 'literary works'],
  ['packaging', 'Product packaging', 'product packaging'],
].map(([key, label, phrase]) => ({ key, label, phrase }));

// Extended rights: each changes a clause. price: draft add-on in cents; null = only by asking the maker.
const EXTRAS = [
  { key: 'derivative', label: 'Adapt it', note: 'Change the creative expression: retouch, composite, colour, make derivative works.', price: 50000 },
  { key: 'entities', label: 'More than one company', note: 'Use by or for several companies or clients under one license.', price: 75000 },
  { key: 'merchandise', label: 'On merchandise', note: 'Cards, posters, apparel, calendars and other goods for resale.', price: null },
  { key: 'exclusive', label: 'Exclusively', note: 'No one else may license it for the same use during the term.', price: null },
];

// What each Watermark use carries, before anything is added.
const BUNDLES = {
  social: ['social'],
  reference: ['social'],
  editorial: ['editorial', 'literary', 'websites', 'educational'],
  commercial: ['websites', 'social', 'marketing', 'presentations'],
  campaign: ['websites', 'social', 'marketing', 'presentations', 'audiovisual', 'packaging'],
  print: [],
};
const PERSONAL = new Set(['social', 'reference']); // personal, not for a business: no rights may be added
const ADD_RIGHT = 15000; // draft: each permitted use added beyond the bundle

// Where: one named place. Countries are ISO 3166-1's (a public standard), named in English by the platform's own
// CLDR data (Intl.DisplayNames); one region, the European Union. The name is stored with the order, so an agreement
// reads the same for good whatever a later list calls the place. Free text is never written into the agreement.
const ISO = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
const REGIONS = { EU: 'European Union' };
let places = null;
function PLACES() {
  if (places) return places;
  let dn = null; try { dn = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) { dn = null; }
  const named = ISO.map(code => { let name = null; try { name = dn ? dn.of(code) : null; } catch (e) { name = null; } return name && name !== code ? { code, name } : null; }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  places = [...Object.entries(REGIONS).map(([code, name]) => ({ code, name, region: true })), ...named];
  return places;
}
// A territory as the order carries it: { code, name }, or null for worldwide. Takes a code ("FR") from a form, or
// what an order already stores (its own name is kept).
function place(v) {
  if (!v) return null;
  if (typeof v === 'object') return /^[A-Z]{2}$/.test(String(v.code || '')) && typeof v.name === 'string' && v.name && v.name.length <= 80 && !/[<>“”"]/.test(v.name) ? { code: v.code, name: v.name } : null;
  const hit = PLACES().find(p => p.code === String(v).trim().toUpperCase());
  return hit ? { code: hit.code, name: hit.name } : null;
}
// How much: a whole number of one of three things. `q` is how it is asked; `says` is the Section 2 sentence.
const SIZES = [
  { key: 'copies', q: 'copies printed', says: n => `You may reproduce the Content in no more than ${n} copies in total, counting every copy, in any form, of every work or material in which the Content appears (the “Limit”).` },
  { key: 'circulation', q: 'copies in circulation', says: n => `You may use the Content only in works or materials whose combined circulation does not exceed ${n} in total (the “Limit”).` },
  { key: 'audience', q: 'people in the audience', says: n => `You may use the Content only before a combined audience that does not exceed ${n} people in total (the “Limit”).` },
];
const num = n => Number(n).toLocaleString('en-US');
// A size of use as the order carries it (its `limit`): { n, of }, or null for unlimited. (Not `size`: a kept album
// picture's stored terms already use that word for its file, src/deliveries.js.)
function limitOf(v) {
  if (!v || typeof v !== 'object') return null;
  const n = typeof v.n === 'number' ? v.n : Number(String(v.n == null ? '' : v.n).replace(/[,\s]/g, ''));
  if (!Number.isInteger(n) || n < 1 || n > 1e9 || !SIZES.some(z => z.key === v.of)) return null;
  return { n, of: v.of };
}

const NEVER_TEXT = {
  ai: 'You shall not use the Content, or allow it to be used, to train, fine-tune, test or otherwise develop any artificial intelligence or machine learning system, or as input for generating synthetic media;',
  political: 'You shall not use the Content in connection with any political campaign, candidate, party or advocacy;',
  alter: null, // governed by 2.5 Modifications
  sensitive: 'You shall not use the Content in connection with tobacco, firearms or gambling;',
};

// Normalise a request into the rights the contract will carry, and price it.
function terms({ use, add = [], extras = [], never = [], base, transfer = null, territory = null, limit = null }) {
  const bundle = BUNDLES[use.key] || [];
  const personal = PERSONAL.has(use.key);
  const addable = personal || use.kind === 'print' ? [] : RIGHTS.filter(r => !bundle.includes(r.key)).map(r => r.key);
  const added = [...new Set([].concat(add))].filter(k => addable.includes(k));
  let ex = personal || use.kind === 'print' ? [] : [...new Set([].concat(extras))].filter(k => EXTRAS.some(e => e.key === k));
  if (never.includes('alter')) ex = ex.filter(k => k !== 'derivative');
  const rights = RIGHTS.filter(r => bundle.includes(r.key) || added.includes(r.key)).map(r => r.key);
  const priced = ex.map(k => EXTRAS.find(e => e.key === k));
  // (#183) Where and how many: for a working license only (a personal piece lives on its holder's own accounts; a
  // print is an object). Either one narrows the license and has no price of its own: it is asked of the maker.
  const working = !personal && use.kind !== 'print';
  const where = working ? place(territory) : null, many = working ? limitOf(limit) : null;
  const narrowed = !!(where || many);
  const ask = priced.some(e => e.price == null) || narrowed;
  const price = base == null || narrowed ? null : base + added.length * ADD_RIGHT + priced.reduce((s, e) => s + (e.price || 0), 0);
  // Transferable: a numbered personal piece (Collect, the Reference, a print) may pass to another person, whole,
  // through a transfer recorded on the register; a working license (story, company, campaign) may not,
  // unless the maker's terms for the work say so. Counsel reviews the wording (docs/CONTRACT.md).
  const transferable = transfer != null ? !!transfer : (personal || use.kind === 'print');
  return { use: use.key, kind: use.kind, personal, rights, added, extras: ex, never, ask, price, addable, term_months: use.term_months, transferable, ...(where ? { territory: where } : {}), ...(many ? { limit: many } : {}) };
}

const list = a => (a.length <= 1 ? a.join('') : a.length === 2 ? a.join(' and ') : `${a.slice(0, -1).join(', ')}, and ${a[a.length - 1]}`);
const dur = m => (m % 12 === 0 ? `${m / 12} year${m === 12 ? '' : 's'}` : `${m} months`);
const termPhrase = m => (m ? `for a term of ${dur(m)} from the date of your order` : 'perpetual');

// (#184) Section 3 of a credit-only license: no fee, the credit is the consideration. First draft, not counsel's words.
const CREDIT_ONLY = 'No fee is payable for the rights granted herein. As consideration in full for those rights, you shall credit Licensor by name with each use of the Content, wherever the use allows, in the form specified by Licensor or, where none is specified, as “Photograph by” followed by Licensor’s name. A use without that credit, where the use allows it, is not permitted by this Agreement.';
// (#184) Said plainly wherever the house hands over this agreement: it is a form, not advice. A draft for Will and counsel.
const FORM_NOT_ADVICE = 'The agreement is a standard form. The house does not give legal advice; for advice about your own case, ask a lawyer.';
// The fingerprint an order keeps: the exact text assembled for it, as /buy has always stored it (version, then hash).
function seal(t, { work, maker, ref }) {
  const out = { ...t, version: 'standard-2021-counsel/v0' };
  out.hash = require('crypto').createHash('sha256').update(JSON.stringify(assemble({ t, work, maker, ref }))).digest('hex');
  return out;
}

// The agreement as numbered sections: [{ n, h, p: [paragraphs], items?: [] }].
function assemble({ t, work, maker, licensee, ref, price, date, entity = 'Watermark Ventures, Inc.' }) {
  const s = [];
  const perpetual = !t.term_months;
  const kinds = ['non-exclusive', perpetual ? 'perpetual' : null, t.transferable ? 'transferable only as set out in Section 9.3' : 'non-transferable', 'non-sublicensable'].filter(Boolean);
  if (t.extras.includes('exclusive')) kinds[0] = 'exclusive';
  s.push({ n: '', h: '', p: [`This AGREEMENT (the “Agreement”) between you${licensee ? ` (${licensee})` : ''} and ${maker ? `${maker}, ` : ''}the creator of the content that you have selected to access (“Licensor”) governs your use of the Licensor content identified in your order${work ? ` (${work}${ref ? `, order ${ref}` : ''})` : ''} (the “Content”). By copying or downloading content from Licensor through the content licensing platform provided by ${entity} (“Watermark”), you accept the terms of this Agreement. If you do not agree with the terms of this Agreement, you may not copy or download the Content. You and Licensor each hereby agree as follows:`] });
  s.push({ n: '1', h: 'Content License; Ownership', p: [`Subject to the terms and conditions of this Agreement, Licensor hereby grants to you a ${kinds.join(', ')} license${perpetual ? '' : ` ${termPhrase(t.term_months)}`}, solely to reproduce, perform publicly, display, transmit, and distribute the Content in all media solely for the purposes set forth herein. Licensor reserves all rights not expressly granted to you under this Agreement. Except for the licenses expressly granted to you in this Agreement, you acknowledge that all right, title, and interest in and to the Content is controlled by Licensor.`] });
  const permitted = t.kind === 'print'
    ? 'This order is for a physical print of the Content. You may display the print privately or publicly and may sell or give the print itself. No right to reproduce the Content is granted.'
    : t.personal
      ? 'Subject to the terms and conditions herein, you may use the Content on your own personal social media accounts and devices, credited to Licensor, and not for or on behalf of any business.'
      : `Subject to the terms and conditions herein, you may use the Content on ${list(RIGHTS.filter(r => t.rights.includes(r.key)).map(r => r.phrase))}.`;
  const restr = [
    'You shall not use the Content in a pornographic, defamatory, obscene, or otherwise unlawful manner;',
    'You shall not use the Content as part of a trademark, service mark, trade dress, logo or other source identifying asset;',
    'You shall not use the Content in a way that allows others to download, extract, or redistribute the Content as a standalone file;',
    'You shall not use the Content with material that violates any third party rights, or otherwise take any action in connection with the Content that violates the rights of others;',
    t.extras.includes('entities') ? null : 'You shall not use the Content other than for your own benefit or for the benefit of a single company/client without additional licenses;',
    'You shall not falsely represent that you are the original creator of the Content;',
    t.extras.includes('merchandise') ? null : 'You shall not use the Content in connection with any goods or services intended for resale or distribution where the primary value of such goods or services is in the Content itself including, without limitation, cards, stationery items, paper products, calendars, apparel items, posters, DVDs, mobile applications or other items for resale, on-demand merchandise printing, license or other distribution for profit;',
    ...t.never.map(k => NEVER_TEXT[k]).filter(Boolean),
  ].filter(Boolean);
  restr[restr.length - 1] = restr[restr.length - 1].replace(/;$/, '.');
  const mods = t.extras.includes('derivative')
    ? 'You may adapt the Content for your intended use and may modify its creative expression and create derivative works of the Content within the uses permitted herein, provided that you shall not represent any modified version as the unaltered work of Licensor.'
    : 'You may adapt the Content (for example, resizing, minor cropping, embedding) for your intended use, however you shall not modify the creative expression of the Content or create any derivative works of the Content without Licensor’s express prior written permission.';
  s.push({ n: '2', h: 'Usage of the Content', p: ['Notwithstanding any other provision to the contrary contained in this Agreement:'], sub: [
    { n: '2.1', h: 'Permitted Uses', p: [permitted] },
    { n: '2.2', h: 'Copyright Notices', p: ['You shall ensure that your use of the Content is marked with the appropriate copyright notices specified by Licensor.'] },
    { n: '2.3', h: 'Attribution', p: ['You will use commercially reasonable efforts to include attribution for Licensor in accordance with industry standards, including without limitation, in any editorial or audiovisual works.'] },
    { n: '2.4', h: 'Restrictions', p: ['The following restrictions apply to your use of the Content:'], items: restr },
    { n: '2.5', h: 'Modifications', p: [mods] },
    { n: '2.6', h: 'Content Credentials', p: ['The Content may carry embedded provenance information (Content Credentials) identifying Licensor and this license. You shall not remove or alter such information except as the ordinary result of resizing or format conversion.'] },
  ] });
  if (t.extras.includes('exclusive')) s[s.length - 1].sub.push({ n: '2.7', h: 'Exclusivity', p: ['During the term, Licensor shall not grant any other person a license to use the Content for the uses permitted in Section 2.1. Exclusivity does not limit Licensor’s own use of the Content, licenses granted before the date of your order, or uses not listed in Section 2.1.'] });
  // (#183) ADDED, each only when the order carries it; numbered after whatever Section 2 already holds.
  { const sub = s[s.length - 1].sub; const where = place(t.territory), many = limitOf(t.limit);
    if (where) sub.push({ n: `2.${sub.length + 1}`, h: 'Territory', p: [`You may use the Content only within the following territory: ${where.name} (the “Territory”). No right is granted to reproduce, perform publicly, display, transmit or distribute the Content outside the Territory. The Content being accessible from outside the Territory on a website or social media account that you direct to an audience in the Territory is not, of itself, a use outside the Territory.`] });
    if (many) sub.push({ n: `2.${sub.length + 1}`, h: 'Size of Use', p: [`${SIZES.find(z => z.key === many.of).says(num(many.n))} The Limit applies to all of your uses of the Content under this Agreement taken together, for the whole of the Term. No use of the Content beyond the Limit is permitted without an additional license from Licensor.`] }); }
  // (#184) Credit only: the maker asks for no fee, only to be named. ADDED, only when the order carries `credit`; every
  // other order reads as before. A first draft for counsel (REVIEW; docs/COUNSEL.md).
  s.push({ n: '3', h: 'Payment', p: [t.credit ? CREDIT_ONLY : `As consideration in full for the rights granted herein, you shall pay Licensor the one-time fee identified in the order${price ? ` (${price})` : ''} using the Watermark platform, prior to downloading or copying the Content.`] });
  s.push({ n: '4', h: 'Company Use', p: ['If you are licensing the Content on behalf of your employer or company, you hereby: (a) represent and warrant that you have the full legal authority to bind your employer or company; (b) agree that you remain responsible for the use of the Content by your employer or company; (c) agree that the entity that uses the Content agrees to be bound by the terms of this Agreement; and (d) agree to purchase additional licenses of the same Content if it is used by or for multiple entities' + (t.extras.includes('entities') ? ', except as permitted by this order' : '') + '.'] });
  s.push({ n: '5', h: 'Protection of the Content', p: ['You shall immediately notify Watermark of any: (a) actual, suspected, or threatened infringement of the Content; (b) actual, suspected, or threatened claim that use of the Content infringes the rights of any third party; or (c) any other actual, suspected, or threatened claim to which the Content may be subject. With respect to any of the matters listed in this Section as between you and Licensor: (i) Licensor has exclusive control over, and conduct of, all claims and proceedings; (ii) you shall provide Licensor with all assistance that Licensor may reasonably require; and (iii) Licensor shall bear the cost of any proceedings and will be entitled to retain all sums recovered in any action. Licensor or Watermark may discontinue licensing any piece of Content at any time in its sole discretion. Upon notice from Watermark that any content may be subject to a claim of infringement of a third party’s right, Watermark may require you to immediately, and at your own expense, cease using the Content and delete any copies.'] });
  s.push({ n: '6', h: 'Representations and Warranties', sub: [
    { n: '6.1', h: 'Licensor’s Representations and Warranties', p: ['Licensor represents and warrants, solely to and for your benefit, that it has the right to license the Content in connection with your uses permitted hereunder.'] },
    { n: '6.2', h: 'Your Representations and Warranties', p: ['You represent and warrant that:'], items: ['You will not engage or participate in any activity or course of action that could diminish or tarnish the image or reputation of the Content, Licensor, or Watermark, or cause confusion as to the ownership of the Content; and', 'Your use of the Content will not infringe, misappropriate, or otherwise violate the intellectual property or other rights of any third party or violate any applicable regulation or law.'] },
    { n: '6.3', h: 'Disclaimer of Representations and Warranties', caps: true, p: ['EXCEPT AS EXPRESSLY PROVIDED IN THIS SECTION 6, LICENSOR AND WATERMARK EACH EXPRESSLY DISCLAIMS ALL WARRANTIES, WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE, WITH RESPECT TO THE LICENSED PROPERTY, INCLUDING ANY IMPLIED WARRANTY OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT, AND WARRANTIES THAT MAY ARISE OUT OF COURSE OF DEALING, COURSE OF PERFORMANCE, USAGE, OR TRADE PRACTICE.'] },
  ] });
  s.push({ n: '7', h: 'Term and Termination', sub: [
    { n: '7.1', h: 'Term', p: [perpetual ? 'This Agreement is effective until it is terminated by either party (the “Term”).' : `This Agreement is effective from the date of your order and continues for ${dur(t.term_months)}, unless terminated earlier under this Section 7 (the “Term”). It may be renewed through the Watermark platform.`] },
    { n: '7.2', h: 'Termination for Breach', p: ['Licensor may terminate this Agreement at any time if you breach the terms of this Agreement. Upon such termination you shall immediately stop using the Content, delete or destroy any copies and confirm to Licensor in writing that you have complied with this Section.'] },
    { n: '7.3', h: 'Termination by You', p: ['You may terminate this Agreement by ceasing to use the Content and deleting or destroying any copies.'] },
    { n: '7.4', h: 'Termination for Third Party Use', p: ['If your use of the Content becomes subject to use by a social media platform or other third party website for its own purpose, beyond the ordinary license such platform requires to host and display your posts, this Agreement shall immediately terminate and you will remove the Content from such site.'] },
    { n: '7.5', h: 'Effect of Termination', p: ['Upon the expiration or termination of this Agreement for any reason, all rights licensed under this Agreement will revert immediately to Licensor and you shall cause to be inactivated and erased all digital copies of the Content in your control and possession and return or, at Licensor’s written request, destroy, any tangible copies of the Content. Any rights or obligations of the parties in this Agreement which, by their nature, should survive termination or expiration of this Agreement will survive any such termination or expiration.'] },
  ] });
  s.push({ n: '8', h: 'Remedies', sub: [
    { n: '8.1', h: 'Equitable Relief', p: ['You acknowledge your breach of this Agreement may cause Watermark and Licensor irreparable damages, for which an award of damages would not be adequate compensation, and agree that, in the event of such breach or threatened breach, Licensor or Watermark will be entitled to seek equitable relief, including injunctive relief, in addition to any other remedy to which Licensor or Watermark may be entitled at law or in equity. Such remedies are not exclusive but are in addition to all other remedies available at law or in equity.'] },
    { n: '8.2', h: 'Limitation of Liability', caps: true, p: ['WATERMARK AND LICENSOR WILL NOT BE LIABLE UNDER OR IN CONNECTION WITH THIS AGREEMENT FOR INDIRECT, INCIDENTAL, CONSEQUENTIAL, LIQUIDATED, SPECIAL, OR EXEMPLARY DAMAGES OR PENALTIES, INCLUDING LOSSES OF BUSINESS, REVENUE, OR ANTICIPATED PROFITS, REGARDLESS OF WHETHER SUCH DAMAGE WAS FORESEEABLE AND WHETHER WATERMARK OR ITS LICENSORS HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. WATERMARK’S AND LICENSOR’S TOTAL MAXIMUM AGGREGATE LIABILITY UNDER THIS AGREEMENT WILL IN NO EVENT EXCEED $1,000. NOTWITHSTANDING ANY OTHERWISE APPLICABLE STATUTE OF LIMITATIONS, ANY ACTION OR DISPUTE RESOLUTION PROCEEDING MUST BE COMMENCED WITHIN TWO YEARS OF THE ACT, EVENT, OR OCCURRENCE GIVING RISE TO THE CLAIM. THE FOREGOING DOES NOT AFFECT ANY LIABILITY OR CLAIM WHICH CANNOT BE EXCLUDED OR LIMITED UNDER APPLICABLE LAW.'] },
  ] });
  s.push({ n: '9', h: 'General', sub: [
    { n: '9.1', h: 'Entire Agreement; Amendment', p: ['This Agreement, including and together with any related attachments, constitutes the sole and entire agreement of the parties with respect to the subject matter contained herein. No amendment or modification to this Agreement is effective unless it is in writing and signed by an authorized representative of each party.'] },
    { n: '9.2', h: 'Severability', p: ['If any term or provision of this Agreement is invalid, illegal, or unenforceable in any jurisdiction, such invalidity, illegality, or unenforceability will not affect the enforceability of any other term or provision of this Agreement, or invalidate or render unenforceable such term or provision in any other jurisdiction.'] },
    { n: '9.3', h: 'Assignment', p: [(t.transferable ? 'You may transfer this license, in whole and not in part, to one other person by a transfer recorded on the Watermark register, whereupon your rights under this Agreement end and the transferee holds them subject to all of its terms; Licensor consents in advance to transfers so recorded. Otherwise, you' : 'You') + ' shall not assign any of your rights or delegate any of your obligations under this Agreement without the prior written consent of Licensor. Any purported assignment or delegation in violation of this Section 9.3 is null and void. Licensor may freely assign or otherwise transfer any of its rights or delegate any of its obligations under this Agreement. This Agreement is binding upon and inures to the benefit of the parties hereto and their respective permitted successors and assigns.'] },
    { n: '9.4', h: 'Choice of Law; Venue', p: ['This Agreement and all matters arising out of or relating to this Agreement are governed by the laws of Texas, without giving effect to any conflict of laws provisions thereof that would result in the application of the laws of a different jurisdiction. Either party shall institute any legal suit, action, or proceeding arising out of or relating to this Agreement in the federal or state courts in each case located in Dallas, Texas, and each party irrevocably submits to the exclusive jurisdiction of such courts in any legal suit, action, or proceeding.'] },
    { n: '9.5', h: 'Relationship of the Parties', p: ['The relationship between the parties is that of independent contractors. Nothing contained in this Agreement will be construed as creating any agency, partnership, joint venture, or other form of joint enterprise, employment, or fiduciary relationship between the parties, and neither party has authority to contract for or bind the other party in any manner whatsoever.'] },
    { n: '9.6', h: 'Third Party Beneficiaries', p: ['Except as set forth in this Section 9.6, the parties do not confer any rights or remedies upon any person other than the parties to this Agreement and their respective successors and permitted assigns. Notwithstanding the foregoing, the parties hereby designate Watermark as a third party beneficiary of this Agreement having the right to enforce the terms and conditions herein.'] },
    { n: '9.7', h: 'Waiver', p: ['No waiver by any party of any of the provisions hereof will be effective unless explicitly set forth in writing and signed by the party so waiving. Except as otherwise set forth in this Agreement, no failure to exercise, or delay in exercising, any right, remedy, power, or privilege arising from this Agreement will operate or be construed as a waiver thereof; nor will any single or partial exercise of any right, remedy, power, or privilege hereunder preclude any other or further exercise thereof, or the exercise of any other right, remedy, power, or privilege.'] },
  ] });
  return s;
}

// For counsel: every place the live text departs from the 2021 draft, and the open questions.
const REVIEW = [
  ['FIX', '2.5', 'Draft reads "however you shall modify the creative expression"; the sense is "shall not". Live text says "shall not".'],
  ['FIX', '7.2', '"confirm to License in writing" → "Licensor".'],
  ['FIX', '9.3', '"any of its rights … its obligations" (of the licensee) → "your".'],
  ['FIX', '9.6', '"up on" → "upon".'],
  ['ADDED', '1, 7.1', 'Term: draft grants a perpetual license; Watermark sells 1-year licenses for most uses. Grant and 7.1 now state the term of the order.'],
  ['ADDED', '2.1', 'Permitted uses assembled from what was paid for (the nine categories of the draft). Personal uses (Share it, the Reference) and prints have their own 2.1 text.'],
  ['ADDED', '2.4', 'The maker\'s restrictions: no AI training or synthetic media; no political use; no tobacco, firearms, gambling (each only if the maker sets it).'],
  ['ADDED', '2.4(e), (g), 2.5, 4', 'Lifted or changed only when the licensee pays for More than one company, On merchandise, or Adapt it.'],
  ['ADDED', '2.6', 'Content Credentials: the licensee may not strip the embedded provenance.'],
  ['ADDED', '2.7', 'Exclusivity, when agreed with the maker.'],
  ['ADDED', 'Territory (2.7, or 2.8 after Exclusivity)', 'Only when the order names a territory (one country, or the European Union); an order that names none has no such clause and stays worldwide, as before. First draft, not counsel\'s words: "You may use the Content only within the following territory: [name] (the “Territory”). No right is granted to reproduce, perform publicly, display, transmit or distribute the Content outside the Territory. The Content being accessible from outside the Territory on a website or social media account that you direct to an audience in the Territory is not, of itself, a use outside the Territory."'],
  ['ADDED', 'Size of Use (the next number in Section 2)', 'Only when the order states a number; an order that states none has no such clause and stays unlimited, as before. One of three first sentences: "You may reproduce the Content in no more than [n] copies in total, counting every copy, in any form, of every work or material in which the Content appears (the “Limit”)."; or "You may use the Content only in works or materials whose combined circulation does not exceed [n] in total (the “Limit”)."; or "You may use the Content only before a combined audience that does not exceed [n] people in total (the “Limit”)." Then, always: "The Limit applies to all of your uses of the Content under this Agreement taken together, for the whole of the Term. No use of the Content beyond the Limit is permitted without an additional license from Licensor."'],
  ['ADDED', '7.4', 'Draft would end the license the moment a buyer posts to Instagram (platforms take a license to host posts). Narrowed to use beyond the ordinary hosting license.'],
  ['OPEN', 'Parties', 'Licensing platform named as Watermark Ventures, Inc. Confirm the entity, and whether Krafft is Licensor for the Krafft Collection.'],
  ['OPEN', '9.4', 'Texas law, Dallas courts. Confirm, given New York.'],
  ['OPEN', '8.2', 'Liability cap $1,000 is below some fees ($2,500). Consider "the fees paid under this order".'],
  ['OPEN', '6', 'No statement on model or property releases, and no indemnity. Getty-style tiers offer indemnity; decide what Watermark offers.'],
  ['DRAFTED', '9.3', 'Numbered personal licenses (Collect, Reference, print) are transferable in whole through a register-recorded transfer, with Licensor\'s advance consent; working licenses stay non-transferable unless the maker\'s terms say so. Wording for counsel.'],
  ['OPEN', 'Territory', 'Section 1 still grants use "in all media"; the Territory clause relies on Section 2\'s opening words ("Notwithstanding any other provision") to narrow it. Is that enough, or should the grant itself name the territory? The last sentence (a site directed to the Territory may be reached from elsewhere) is ours: without it a website could not keep the clause; with it, is "direct to an audience" certain enough? Countries are named as the ISO 3166-1 list names them in English, and "European Union" is not tied to a date: should it be its members at the date of the order? With Exclusivity (2.7), is the exclusivity only within the Territory?'],
  ['OPEN', 'Size of Use', 'How a copy, a circulation and an audience are counted online (a page view, a follower, a reader) is not said; nor is who counts, or what the licensee must report. Should the clause be offered for websites and social media at all, or only for printed and broadcast uses? The remedy for going over is the general one (7.2); should it be a further fee instead?'],
  ['OPEN', 'Territory, Size of Use: the asking', 'A license narrowed in either way is never sold at once: the request goes to the maker with the narrowed terms attached, the maker names the fee, and the licensee pays by the link sent. The licensee is not shown the click-through line at that payment. Confirm what acceptance a narrowed license needs.'],
  ['ADDED', '3 (credit only)', 'Only when the maker asks for credit and no fee (a use priced at nothing, or a request granted for credit, or a license the maker writes at no fee); every other order keeps counsel\'s Section 3. First draft: "' + 'No fee is payable for the rights granted herein. As consideration in full for those rights, you shall credit Licensor by name with each use of the Content, wherever the use allows, in the form specified by Licensor or, where none is specified, as “Photograph by” followed by Licensor’s name. A use without that credit, where the use allows it, is not permitted by this Agreement.' + '" Is credit alone sufficient consideration? Does the last sentence make a missing credit a breach (7.2) rather than a use outside the license?'],
  ['OPEN', 'A license the maker writes', 'A maker may write this same agreement for a deal that began off the house (a comment, a message, an email): the maker answers the questions, the other side opens a link, gives their name and address, ticks that they accept and presses Accept (or pays the fee the maker named, through the house). The preamble still speaks of "copying or downloading content … through the content licensing platform". Is acceptance by that press enough, and does the preamble need a sentence for this case? The house takes no share of such a fee (Will has not decided otherwise).'],
  ['OPEN', 'Acceptance', 'Click-through acceptance at checkout; confirm this is enough for exclusivity and merchandise orders, or require a signature.'],
];

module.exports = { RIGHTS, EXTRAS, BUNDLES, ADD_RIGHT, SIZES, PLACES, place, limitOf, terms, assemble, seal, CREDIT_ONLY, FORM_NOT_ADVICE, REVIEW };

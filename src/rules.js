// The maker's say. Every work carries its own terms: which uses are open, whether each
// license needs the maker's approval, and what the work may never be used for.
// The conditions are copied into each license, its certificate and the delivered file.
const NEVER = {
  ai: 'Training or fine-tuning AI models',
  political: 'Political campaigns or advocacy',
  alter: 'Altering the photograph beyond cropping and resizing',
  sensitive: 'Tobacco, firearms or gambling',
};
const DEFAULT = { uses: null, approve: false, never: ['ai', 'alter'], credit: true, showEarned: false };

function parse(json) {
  let r = {}; try { r = JSON.parse(json || '{}') || {}; } catch (e) { r = {}; }
  return { ...DEFAULT, ...r, never: Array.isArray(r.never) ? r.never.filter(k => NEVER[k]) : DEFAULT.never };
}
const allows = (rules, key) => !rules.uses || rules.uses.includes(key);
function conditions(rules) {
  const parts = [];
  if (rules.never.length) parts.push('Not for: ' + rules.never.map(k => NEVER[k].toLowerCase()).join('; '));
  if (rules.credit) parts.push('Credit the maker wherever the use allows');
  return parts.join('. ');
}
module.exports = { NEVER, DEFAULT, parse, allows, conditions };

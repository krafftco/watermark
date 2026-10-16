/* Watermark embed. Place a held work on any site with its credit and license attached:
   <script src="__WM_BASE__/embed.js" defer></script>
   <watermark-image work="florence-at-dusk"></watermark-image>
   Shows the screen-size image only. The faint mark is the button. Each placement is counted for the maker. */
(function () {
  if (!window.customElements || customElements.get('watermark-image')) return;
  var BASE = '__WM_BASE__';
  var MARK = '<svg viewBox="1.5 17.1 41 5.25" aria-hidden="true"><path fill="currentColor" d="M40.9019,20.248c.0496.0348.1284.1018.21.14.0392.0183.1355.0555.1748.0725.142.0613.2106.0623.2106.0623.4242.1069.61-.0405.61-.0405,0,0,.0188-.0104.0372-.0243.0184-.014.0363-.0314.0458-.0406.0151-.0146.0539-.0644.0539-.0644,0,0,.052-.0909.0637-.1237.0071-.0198.024-.0795.024-.0795.0222-.0965.0109-.1126.0246-.2317.0093-.0811-.0287-.3268-.0598-.4078-.0365-.0952-.1166-.3107-.1703-.4046-.0609-.1065-.288-.3048-.3726-.4039-.0684-.0801-.1447-.1568-.2296-.2285-.1278-.108-.4529-.423-.699-.5881-.1149-.077-.4531-.3086-.661-.3576-.1954-.0461-.5058-.1799-.7093-.2207-.1562-.0313-.3892-.0664-.5873-.0663-.1141.0029-1.5885.0597-2.7094,1.0659-.3753.3369-.3855.3946-.8039.8574-1.32,1.4605-2.8991,1.493-4.248.0839-2.6425-2.7603-4.3029-2.7712-7.0126-.0458-1.4491,1.4575-2.8945,1.5826-4.2166-.0527-2.0205-2.4992-5.04-2.4249-6.9906-.0205-1.4506,1.788-2.9277,1.5387-4.6146-.3402-1.5584-1.7356-3.6345-2.0457-5.3761-.7779-.3208.2335-.6042.5574-.9828.9127-.3769.3368-.7879,2.0455.8259,1.4273.2077-.0796.4772-.3289.6437-.4599,1.37-1.0769,2.6549-.9274,3.9243.3511,2.7283,2.7477,4.1663,2.7285,6.9293-.0031,1.449-1.4325,2.9109-1.5845,4.2323.0157,2.0744,2.512,4.8342,2.5441,6.9759.0433,1.4851-1.7342,2.9311-1.5102,4.6445.3102,1.7438,1.8528,3.6846,2.1267,5.4476.7528.2651-.2066.5093-.4648.7507-.7199.9751-1.0303,1.776-1.4668,2.6072-1.416,0-.052.6333.1119.8306.2146.0961.05.3577.1959.4835.268.0829.0476.2447.1927.3365.2464l.1702.1427.1157.0958.071.0558Z"/></svg>';
  var css = ':host{display:block;position:relative;line-height:0;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;font-family:"Helvetica Neue",Arial,sans-serif;container-type:inline-size}' +
    'figure{margin:0;position:relative;background:#0b0a09}img{display:block;width:100%;height:auto;pointer-events:none;-webkit-user-drag:none}.sh{position:absolute;inset:0}' +
    '.k{position:absolute;right:12px;bottom:12px;width:44px;height:26px;padding:8px 9px;border:0;border-radius:13px;background:rgba(11,10,9,.35);color:#fff;opacity:.6;cursor:pointer;line-height:0;transition:opacity .3s}.k svg{width:100%;height:100%}:host(:hover) .k,.k:focus-visible{opacity:1}' +
    '.card{position:absolute;left:12px;right:12px;bottom:12px;max-width:380px;padding:16px 18px;background:rgba(11,10,9,.88);color:#ece7de;line-height:1.45;opacity:0;transform:translateY(6px);pointer-events:none;transition:opacity .35s,transform .35s}:host([open]) .card{opacity:1;transform:none;pointer-events:auto}' +
    '.t{margin:0 0 4px;font:italic 400 17px/1.35 Georgia,serif}.c{margin:0 0 12px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#a39b8e}.a{display:flex;flex-wrap:wrap;gap:14px}' +
    '.a a{color:#ece7de;font-size:11px;letter-spacing:.2em;text-transform:uppercase;text-decoration:none;border-bottom:1px solid #b39a68;padding-bottom:3px}.w{margin:12px 0 0;font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:#7d766b}.w a{color:inherit;text-decoration:none}' +
    '@container (max-width:380px){.card{left:8px;right:8px;bottom:8px;padding:10px 12px}.t{font-size:15px}.c{font-size:9.5px;margin:0 0 8px}.a{flex-direction:column;gap:7px}.a a{font-size:9.5px;align-self:flex-start}.w{display:none}}';
  function esc(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function seen(work, kind) { try { navigator.sendBeacon(BASE + '/api/seen', new Blob([JSON.stringify({ work: work, host: location.hostname, kind: kind })], { type: 'application/json' })); } catch (e) {} }
  class WatermarkImage extends HTMLElement {
    connectedCallback() {
      if (this._r) return;
      var self = this, slug = this.getAttribute('work');
      var root = this._r = this.attachShadow({ mode: 'closed' });
      root.innerHTML = '<style>' + css + '</style><figure></figure>';
      fetch(BASE + '/api/work/' + encodeURIComponent(slug)).then(function (r) { return r.json(); }).then(function (w) {
        if (!w || !w.image) return;
        root.querySelector('figure').innerHTML = '<img alt="' + esc(w.title) + '" loading="lazy" draggable="false" src="' + esc(w.image) + '"><span class="sh"></span>' +
          '<button class="k" type="button" aria-label="About this photograph" aria-expanded="false">' + MARK + '</button>' +
          '<div class="card" role="group" aria-label="Credit and license"><p class="t">' + esc(w.title) + '</p><p class="c">Photograph by ' + esc(w.maker) + '</p>' +
          '<div class="a"><a href="' + esc(w.license) + '" target="_blank" rel="noopener">License this photograph</a><a href="' + esc(w.page) + '" target="_blank" rel="noopener">See the work</a></div>' +
          '<p class="w"><a href="' + BASE + '/about" target="_blank" rel="noopener">Held on Watermark</a></p></div>';
        var btn = root.querySelector('.k');
        function toggle(on) { if (on) { self.setAttribute('open', ''); seen(slug, 'open'); } else self.removeAttribute('open'); btn.setAttribute('aria-expanded', String(!!on)); }
        btn.addEventListener('click', function (e) { e.stopPropagation(); toggle(!self.hasAttribute('open')); });
        root.querySelector('.sh').addEventListener('click', function () { toggle(!self.hasAttribute('open')); });
        self.addEventListener('contextmenu', function (e) { e.preventDefault(); toggle(true); });
        seen(slug, 'embed');
      }).catch(function () {});
    }
  }
  customElements.define('watermark-image', WatermarkImage);
})();

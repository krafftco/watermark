/* Retired (20 Nov 2026, #178). The house has no trade side: no header chip, no panel on a work's page. No page asks
   for this file any more; it is kept for one release for pages already open or kept by a browser, and all it does is
   forget the old switch on this device. */
(function () { try { if (/(?:^|;\s*)wm_trade=/.test(document.cookie)) document.cookie = 'wm_trade=; Max-Age=0; path=/; SameSite=Lax'; } catch (e) {} })();

/**
 * Inline loader for the public site shell (index.html).
 *
 * Injected by scripts/marketing-prerender.mjs during `vite build`, into the
 * SPA document only. Prerendered /website pages are copies of that document
 * plus their own head snippet, so this script ships on both.
 *
 * It must not contain the contiguous string
 * gtag/js?id= plus the measurement id. Marketing HTML already has that URL
 * once, in the head snippet, and a second copy would make every /website
 * page look like it loads gtag twice.
 *
 * The head snippet's config call is left untouched. This loader calls config
 * only when no gtag script is already in the document, and only on `/` or on
 * a `/website` path. App routes such as `/Auth` and `/Dashboard` never load
 * the tag. The config sends a single page view (`send_page_view: false`, then
 * one explicit page_view) and does not follow SPA navigations. If history
 * later moves to any other path, `ga-disable-<id>` is set before the original
 * history method runs, so a later hit cannot carry an app URL.
 */

export const GA4_MEASUREMENT_ID = 'G-6Q6XS6C8B0';

export const SITE_GTAG_SNIPPET = [
  '(function () {',
  '  if (!window.__crStoreClicks) {',
  '    window.__crStoreClicks = true;',
  '    document.addEventListener("click", function (event) {',
  '      if (typeof window.gtag !== "function") return;',
  '      var node = event.target;',
  '      if (!node || typeof node.closest !== "function") return;',
  '      var link = node.closest("a");',
  '      if (!link) return;',
  '      var href = link.getAttribute("href") || "";',
  '      var eventName = "";',
  '      if (href.indexOf("apps.apple.com/app/carreminder/id6764073107") !== -1) eventName = "app_store_click";',
  '      else if (href.indexOf("play.google.com/store/apps/details?id=com.carreminder.app") !== -1) eventName = "play_store_click";',
  '      if (!eventName) return;',
  '      var marked = link.closest("[data-link-location]");',
  '      var section = link.closest("section[id]");',
  '      var linkLocation = (marked && marked.getAttribute("data-link-location")) || (section && section.id) || "other";',
  '      window.gtag("event", eventName, {',
  '        link_location: linkLocation,',
  '        page_path: location.pathname,',
  '        transport_type: "beacon"',
  '      });',
  '    }, true);',
  '  }',
  '',
  '  if (window.__crGtag) return;',
  '  if (document.querySelector(\'script[src*="googletagmanager.com/gtag/js"]\')) {',
  '    window.__crGtag = true;',
  '    return;',
  '  }',
  '  var host = location.hostname;',
  '  if (host !== "car-reminder.app" && host !== "www.car-reminder.app") return;',
  '  var framed = false;',
  '  try { framed = window.top !== window.self; } catch (e) { framed = true; }',
  '  if (framed) return;',
  '  var native = false;',
  '  try {',
  '    native = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform());',
  '  } catch (e) { native = false; }',
  '  if (native) return;',
  '  var path = location.pathname || "";',
  '  var onMeasuredPath = path === "/" || path === "/website" || path.indexOf("/website/") === 0;',
  '  if (!onMeasuredPath) return;',
  '',
  '  window.__crGtag = true;',
  '  var measurementId = "' + GA4_MEASUREMENT_ID + '";',
  '  var disableKey = "ga-disable-" + measurementId;',
  '  function blockAppPath(nextUrl) {',
  '    var nextPath = path;',
  '    if (typeof nextUrl === "string" && nextUrl) {',
  '      try { nextPath = new URL(nextUrl, location.href).pathname; } catch (e) { nextPath = path; }',
  '    }',
  '    var stillMeasured = nextPath === "/" || nextPath === "/website" || nextPath.indexOf("/website/") === 0;',
  '    if (!stillMeasured) window[disableKey] = true;',
  '  }',
  '  function wrapHistory(name) {',
  '    try {',
  '      var orig = history[name];',
  '      if (typeof orig !== "function" || orig.__crGaWrapped) return;',
  '      var wrapped = function (state, title, url) {',
  '        blockAppPath(url);',
  '        return orig.apply(this, arguments);',
  '      };',
  '      wrapped.__crGaWrapped = true;',
  '      history[name] = wrapped;',
  '    } catch (e) {}',
  '  }',
  '  wrapHistory("pushState");',
  '  wrapHistory("replaceState");',
  '  window.addEventListener("popstate", function () { blockAppPath(location.pathname); }, true);',
  '  window.dataLayer = window.dataLayer || [];',
  '  window.gtag = function () { window.dataLayer.push(arguments); };',
  '  window.gtag("js", new Date());',
  '  var pageLocation = location.origin + path;',
  '  window.gtag("config", measurementId, { send_page_view: false, page_location: pageLocation });',
  '  window.gtag("event", "page_view", { page_location: pageLocation, page_path: path });',
  '  var script = document.createElement("script");',
  '  script.async = true;',
  '  script.src = "https://www.googletagmanager.com/gtag/js?id=" + measurementId;',
  '  if (typeof script.addEventListener === "function") {',
  '    script.addEventListener("load", function () {',
  '      wrapHistory("pushState");',
  '      wrapHistory("replaceState");',
  '    });',
  '  }',
  '  document.head.appendChild(script);',
  '})();',
].join('\n');

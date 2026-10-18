// Last real content change per marketing route, as YYYY-MM-DD.
// Whoever changes a page's content updates its date in this map.
//
// Dates are taken from git history of the page copy: marketingContent.js,
// marketingSpecialties.js, and Marketing.jsx for /website and /website/business.
// A route whose real date cannot be determined is omitted. That URL gets no
// sitemap lastmod, and a guide gets no dateModified. Do not stamp build time,
// and do not reuse one date for every URL.
//
// /website/vehicle-check is omitted: the sitemap already leaves it out.

export const contentLastModified = {
  '/website': '2026-09-13',
  '/website/business': '2026-09-13',
  '/website/offroad': '2026-09-10',
  '/website/trucks': '2026-09-10',
  '/website/heavy-equipment': '2026-09-10',
  '/website/classic-cars': '2026-09-10',
  '/website/inactive-vehicles': '2026-09-25',
  '/website/accessibility': '2026-09-11',
  '/website/child-in-car-reminder': '2026-09-11',
  '/website/documents': '2026-09-25',
  '/website/vessels': '2026-09-10',
  '/website/vehicle-lookup': '2026-09-25',
  '/website/test-insurance-reminders': '2026-09-25',
  '/website/guides/engine-hours': '2026-09-10',
  '/website/guides/equipment-documents': '2026-09-10',
  '/website/guides/collector-status': '2026-09-10',
  '/website/guides/test-reminder': '2026-10-18',
  '/website/guides/vehicle-documents': '2026-09-10',
  '/website/guides/maintenance-log': '2026-09-25',
  '/website/guides/plate-check': '2026-09-25',
  '/website/guides/vessel-records': '2026-09-10',
};

// Same URL set and the same vehicle-check exclusion as the prerender.
// A route missing from the map is still listed, without <lastmod>.
export function sitemapUrlSet(origin, routes, escapeXml = value => value) {
  const urls = routes
    .filter(route => route !== '/website/vehicle-check')
    .map(route => {
      const date = contentLastModified[route];
      const lastmod = date ? `<lastmod>${date}</lastmod>` : '';
      return `<url><loc>${escapeXml(`${origin}${route}`)}</loc>${lastmod}</url>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

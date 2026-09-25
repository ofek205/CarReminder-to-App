import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { marketingRoutes, marketingMetadata } from '../src/lib/marketingContent.js';
import { SITE_GTAG_SNIPPET } from '../src/lib/siteGtagSnippet.js';

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

/**
 * GA4, on every /website/* page. Deliberately NOT gated behind `origin`
 * the way canonical/schema/robots are: those must stay production-only
 * because indexing a staging copy is a real SEO cost, but a few staging
 * test hits in a brand-new GA4 property are not the same kind of harm,
 * and gating this the same way would make it impossible to verify via
 * DebugView/Realtime before this ever reaches production.
 *
 * No existing cookie-consent banner runs on this site today (checked
 * before adding this), so there is nothing here for this script to
 * violate. The one honest caveat: marketingEvents.js's own comment says
 * "a future collector should subscribe only after its consent
 * requirements have been met" — this is that future collector, and it
 * does not wait for anything. Flagged, not silently decided.
 */
const GA4_SNIPPET = `<script async src="https://www.googletagmanager.com/gtag/js?id=G-6Q6XS6C8B0"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-6Q6XS6C8B0');</script>`;

// The SPA shell gets SITE_GTAG_SNIPPET during the same build, via
// transformIndexHtml below. Prerender copies dist/index.html, so every
// /website page inherits that script. The snippet bails out when this
// head tag is already present, and it must not contain the contiguous
// gtag URL or each marketing page would show two of them. The config
// call in GA4_SNIPPET stays exactly as it is.

export function marketingPrerender() {
  let config;
  return {
    name: 'carreminder-marketing-html',
    apply: 'build',
    transformIndexHtml(html) {
      if (html.includes('__crStoreClicks')) return html;
      if (!html.includes('</body>')) throw new Error('index.html has no </body> for the site gtag snippet');
      return html.replace('</body>', `<script>${SITE_GTAG_SNIPPET}</script>\n</body>`);
    },
    configResolved(value) { config = value; },
    async closeBundle() {
      const output = path.resolve(config.root, config.build.outDir);
      const template = (await fs.readFile(path.join(output, 'index.html'), 'utf8')).replaceAll('="./', '="/');
      const assets = await fs.readdir(path.join(output, 'assets'));
      const marketingCss = assets.filter(name => /^Marketing-.*\.css$/.test(name));
      if (!marketingCss.length) throw new Error('Marketing stylesheet was not emitted');
      const origin = config.env.VITE_MARKETING_SITE_ORIGIN?.replace(/\/$/, '');
      if (origin && !/^https:\/\/[^/]+$/.test(origin)) throw new Error('VITE_MARKETING_SITE_ORIGIN must be an HTTPS origin without a path');
      const server = await createServer({
        configFile: false, root: config.root, plugins: [react()],
        cacheDir: path.resolve(config.root, 'node_modules/.vite-marketing-ssr'),
        resolve: { alias: { '@': path.resolve(config.root, 'src') }, dedupe: ['react', 'react-dom', 'react-router', 'react-router-dom'] },
        optimizeDeps: { noDiscovery: true, include: [] },
        server: { middlewareMode: true, watch: null }, appType: 'custom',
      });
      try {
        const { default: Marketing } = await server.ssrLoadModule('/src/pages/Marketing.jsx');
        for (const route of marketingRoutes) {
          const meta = marketingMetadata(route);
          // Never render a lookup or cached report at build time.
          const markup = route === '/website/vehicle-check'
            ? '<main dir="rtl"><h1>בדיקת רכב לפי מספר רישוי</h1><p>הקלידו מספר רישוי באתר כדי לראות את הנתונים הזמינים ולהוריד מסמך.</p><a href="/website#check">לטופס בדיקת הרכב</a></main>'
            : renderToString(React.createElement(StaticRouter, { location: route }, React.createElement(Marketing)));
          let html = template.replace(/<div id="root">[\s\S]*?(?=\s*<style>\s*@keyframes cr-boot-spin)/, `<div id="root">${markup}</div>`);
          if (!html.includes(markup)) throw new Error('Cannot locate the application root for marketing HTML');
          html = html.replace(/<title>.*?<\/title>/, `<title>${escape(meta.title)}</title>`)
            .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${escape(meta.description)}" />`)
            .replace(/<meta name="viewport"[^>]*>/, '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />');
          const canonical = origin ? `<link rel="canonical" href="${escape(origin + route)}" />` : '';
          /**
           * Social preview tags.
           *
           * Until now every one of these pages shipped og:title and
           * og:description with NO og:image, so a link shared to WhatsApp,
           * Facebook or LinkedIn rendered as a bare URL with no picture. That
           * does not affect ranking at all; it affects whether anyone clicks,
           * and for this product WhatsApp is the organic channel that matters.
           *
           * Gated on `origin` for the same reason canonical is: these URLs
           * have to be absolute, and a preview deploy has no honest origin to
           * build them from.
           *
           * Purpose-built 1200x630 covers, not a cropped hero: both carry the
           * wordmark, which is what makes a preview read as the product
           * rather than as a stock photo of a car.
           *
           * The business page gets its own, because the thing being shared
           * there is a fleet console and a phone-in-hand image would promise
           * the wrong product to the wrong reader. Everything else shares the
           * default; per-page art for twenty pages is a cost with no return.
           *
           * JPEG, not WebP, and that is deliberate. Everything else in
           * public/marketing/ is WebP and these two cost 48KB and 70KB as
           * JPEG against 46KB and 62KB as WebP, so the saving was real but
           * tiny. WhatsApp is the channel this whole tag exists to serve and
           * its crawler has a long history of rendering nothing for a WebP
           * og:image. Paying 10KB to remove that risk is not a close call.
           * Both sit far under the ~300KB a preview fetch will pull.
           *
           * twitter:card alone is enough: Twitter falls back to the og:*
           * values for title, description and image, so repeating them here
           * would be three more strings to keep in sync for no gain.
           */
          const OG_IMAGE = route === '/website/business'
            ? '/marketing/og-business.jpg'
            : '/marketing/og-main.jpg';
          const social = origin ? [
            `<meta property="og:type" content="${route.startsWith('/website/guides/') ? 'article' : 'website'}" />`,
            `<meta property="og:site_name" content="Car Reminder" />`,
            `<meta property="og:locale" content="he_IL" />`,
            `<meta property="og:url" content="${escape(origin + route)}" />`,
            `<meta property="og:image" content="${escape(origin + OG_IMAGE)}" />`,
            `<meta property="og:image:width" content="1200" />`,
            `<meta property="og:image:height" content="630" />`,
            `<meta property="og:image:alt" content="${escape('Car Reminder, ניהול רכב, אופנוע וכלי שיט')}" />`,
            `<meta name="twitter:card" content="summary_large_image" />`,
          ].join('') : '';
          const schema = origin && route !== '/website/vehicle-check' ? `<script id="cm-seo-schema" type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', name: meta.title, description: meta.description, url: origin + route, inLanguage: 'he' }).replaceAll('<', '\\u003c')}</script>` : '';
          html = html.replace('</head>', `${marketingCss.map(name => `<link rel="stylesheet" href="/assets/${name}" />`).join('')}<meta name="robots" content="${origin && route !== '/website/vehicle-check' ? 'index,follow' : 'noindex,follow'}" /><meta property="og:title" content="${escape(meta.title)}" /><meta property="og:description" content="${escape(meta.description)}" />${social}${canonical}${schema}${GA4_SNIPPET}</head>`);
          const destination = path.join(output, route.slice(1), 'index.html');
          await fs.mkdir(path.dirname(destination), { recursive: true });
          await fs.writeFile(destination, html);
        }
        if (origin) {
          const urls = marketingRoutes.filter(route => route !== '/website/vehicle-check').map(route => `<url><loc>${escape(origin + route)}</loc></url>`).join('');
          await fs.writeFile(path.join(output, 'website/sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
        }
        // robots.txt is emitted here, not shipped from public/, so that the
        // SAME switch that decides index-vs-noindex decides this too. A
        // static public/robots.txt would say "Allow: /" on every test
        // deployment as well, and that matters more than it looks: Vercel's
        // automatic noindex on preview URLs stops applying once a custom
        // domain is attached, which would leave a test copy of the whole
        // site crawlable and competing with production for the same terms.
        //
        // Production gets crawl access plus the sitemap. Anything without a
        // configured origin (previews, staging, local builds) gets a blanket
        // Disallow. Note the deliberate asymmetry with /website/vehicle-check,
        // which is crawlable-but-noindex: there we WANT the crawler to read
        // the noindex so an externally linked URL drops out of the index.
        // Here there are no external links to protect against, so refusing
        // the crawl outright is both cheaper and stricter.
        await fs.writeFile(path.join(output, 'robots.txt'), origin
          ? `User-agent: *\nAllow: /\n\nSitemap: ${origin}/website/sitemap.xml\n`
          : 'User-agent: *\nDisallow: /\n');
        console.info(`Marketing: rendered ${marketingRoutes.length} local pages (${origin ? 'configured canonical origin' : 'noindex preview'}), robots.txt ${origin ? 'allows crawling' : 'disallows all'}.`);
      } finally { await server.close(); }
    },
  };
}

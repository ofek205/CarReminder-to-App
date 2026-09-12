import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { marketingRoutes, marketingMetadata } from '../src/lib/marketingContent.js';

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export function marketingPrerender() {
  let config;
  return {
    name: 'carreminder-marketing-html',
    apply: 'build',
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
          const schema = origin && route !== '/website/vehicle-check' ? `<script id="cm-seo-schema" type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', name: meta.title, description: meta.description, url: origin + route, inLanguage: 'he' }).replaceAll('<', '\\u003c')}</script>` : '';
          html = html.replace('</head>', `${marketingCss.map(name => `<link rel="stylesheet" href="/assets/${name}" />`).join('')}<meta name="robots" content="${origin && route !== '/website/vehicle-check' ? 'index,follow' : 'noindex,follow'}" /><meta property="og:title" content="${escape(meta.title)}" /><meta property="og:description" content="${escape(meta.description)}" />${canonical}${schema}</head>`);
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

import { marketingMetadata } from './marketingContent';

// Use the approved public domain only after it has been configured.
// Local previews stay out of indexes and do not claim a production canonical.
export function applyMarketingSeo(path) {
  const metadata = marketingMetadata(path);
  const restores = [];
  function tag(selector, attributes) {
    let element = document.head.querySelector(selector);
    const created = !element;
    if (!element) { element = document.createElement(selector.startsWith('script') ? 'script' : selector.startsWith('link') ? 'link' : 'meta'); document.head.appendChild(element); }
    const previous = [...element.attributes].map(attr => [attr.name, attr.value]);
    const previousText = element.textContent;
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    restores.push(() => {
      if (created) element.remove();
      else { for (const attr of [...element.attributes]) element.removeAttribute(attr.name); for (const [key, value] of previous) element.setAttribute(key, value); element.textContent = previousText; }
    });
    return element;
  }
  const previousTitle = document.title;
  document.title = metadata.title;
  tag('meta[name="description"]', { name: 'description', content: metadata.description });
  tag('meta[name="viewport"]', { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' });
  const origin = import.meta.env.VITE_MARKETING_SITE_ORIGIN?.replace(/\/$/, '');
  tag('meta[name="robots"]', { name: 'robots', content: origin && path !== '/website/vehicle-check' ? 'index,follow' : 'noindex,follow' });
  tag('meta[property="og:title"]', { property: 'og:title', content: metadata.title });
  tag('meta[property="og:description"]', { property: 'og:description', content: metadata.description });
  if (origin) tag('link[rel="canonical"]', { rel: 'canonical', href: `${origin}${path}` });
  if (origin) {
    const schema = tag('script#cm-seo-schema', { id: 'cm-seo-schema', type: 'application/ld+json' });
    schema.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', name: metadata.title, description: metadata.description, url: `${origin}${path}`, inLanguage: 'he' });
  }
  return () => { restores.reverse().forEach(restore => restore()); document.title = previousTitle; };
}

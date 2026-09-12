import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { marketingEvent } from '@/lib/marketingEvents';

/**
 * Generic template for a conversion-focused SEO landing page under
 * /website/<slug>: hero with an above-the-fold CTA row (store links and/or
 * an in-site link), a run of H2 body sections, and an optional FAQ block
 * with FAQPage + BreadcrumbList schema.
 *
 * Distinct from MarketingProductPage (2-column hero+sidebar, no FAQ, single
 * CTA) because these three pages were commissioned specifically to carry a
 * download CTA above the fold and a crawlable FAQ, neither of which the
 * generic template supports. Reuses the site's existing cm-* classes
 * (.cm-section/.cm-wrap/.cm-kicker/.cm-button/.cm-gold/.cm-faq/.cm-stores)
 * wherever they already do the right thing; only .cm-landing-* below is new.
 *
 * `product` is a productPages entry from marketingContent.js with
 * `landingPage: true` plus: kicker, ctas[], sections[][heading,text],
 * faqKicker, faq[][question,answer]. See Marketing.jsx's `landingPage`
 * branch for how this is wired into routing (routing/metadata/sitemap are
 * unchanged: driven generically by the same productPages array either way).
 */

function LandingCtas({ ctas, slug }) {
  return <div className="cm-actions cm-landing-ctas">
    {ctas.map((cta, index) => {
      if (cta.type === 'store') {
        const href = cta.store === 'apple'
          ? 'https://apps.apple.com/app/carreminder/id6764073107'
          : 'https://play.google.com/store/apps/details?id=com.carreminder.app';
        return <a key={index} className="cm-landing-store" href={href} target="_blank" rel="noopener noreferrer"
          onClick={() => marketingEvent('store_click', `${slug}_${cta.store}`)}>
          <img src={`/marketing/${cta.store === 'apple' ? 'apple' : 'google-play'}.svg`} width="20" height="23" alt="" />
          <span>{cta.label}</span>
        </a>;
      }
      const className = cta.primary ? 'cm-button cm-gold' : 'cm-button';
      return cta.to
        ? <Link key={index} className={className} to={cta.to}>{cta.label} <ArrowLeft size={17} /></Link>
        : <a key={index} className={className} href={cta.href}>{cta.label} <ArrowLeft size={17} /></a>;
    })}
  </div>;
}

export default function MarketingSeoLandingPage({ product }) {
  useEffect(() => {
    if (!product.faq?.length) return undefined;
    const schema = document.createElement('script');
    schema.id = `cm-${product.slug}-schema`;
    schema.type = 'application/ld+json';
    schema.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Car Reminder', item: '/website' },
            { '@type': 'ListItem', position: 2, name: product.heading || product.title },
          ],
        },
        {
          '@type': 'FAQPage',
          mainEntity: product.faq.map(([name, text]) => ({ '@type': 'Question', name, acceptedAnswer: { '@type': 'Answer', text } })),
        },
      ],
    });
    document.head.appendChild(schema);
    return () => schema.remove();
  }, [product.slug, product.faq, product.heading, product.title]);

  return <article className="cm-landing">
    <section className="cm-section cm-landing-hero">
      <div className="cm-wrap cm-landing-hero-wrap">
        <Link className="cm-text-link" to="/website">חזרה לאתר <ArrowLeft size={17} /></Link>
        {product.kicker && <span className="cm-kicker">{product.kicker}</span>}
        <h1>{product.heading || product.title}</h1>
        <p className="cm-article-lead">{product.text}</p>
        {!!product.ctas?.length && <LandingCtas ctas={product.ctas} slug={product.slug} />}
      </div>
    </section>

    {product.sections.map(([heading, text], index) => (
      <section id={`detail-${index}`} className="cm-section cm-landing-section" key={heading}>
        <div className="cm-wrap"><h2>{heading}</h2><p>{text}</p></div>
      </section>
    ))}

    {!!product.faq?.length && (
      <section className="cm-section cm-faq">
        <div className="cm-wrap cm-faq-grid">
          <div>{product.faqKicker && <span className="cm-kicker">{product.faqKicker}</span>}<h2>שאלות נפוצות</h2></div>
          <div>{product.faq.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div>
        </div>
      </section>
    )}
  </article>;
}

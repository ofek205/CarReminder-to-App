import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, FileText } from 'lucide-react';
import { guides, productPages } from '@/lib/marketingContent';

export default function MarketingProductPage({ product }) {
  const related = (product.relatedPages || []).map(slug => ({ slug, title: productPages.find(page => page.slug === slug)?.title || (slug === 'business' ? 'ניהול צי לעסקים' : 'בדיקת רכב לפי מספר רישוי') }));
  return <article className="cm-section cm-wrap cm-product-page">
    <div><Link className="cm-text-link" to="/website">חזרה לאתר <ArrowLeft size={17} /></Link><h1>{product.heading || product.title}</h1><p className="cm-article-lead">{product.text}</p>
      <div className="cm-product-toc" aria-label="תוכן העמוד">{product.sections.map(([heading], index) => <a key={heading} href={`#detail-${index}`}>{heading}</a>)}</div>
      {product.sections.map(([heading, text], index) => <section id={`detail-${index}`} key={heading}><h2>{heading}</h2><p>{text}</p></section>)}
      {product.sources && <aside className="cm-article-sources"><h2>מקורות רשמיים</h2>{product.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>)}<p>הדרישות עשויות להשתנות. יש לבדוק את ההנחיות העדכניות ואת המסמכים של הכלי המסוים.</p></aside>}
      <div className="cm-actions">{product.business ? <Link className="cm-button" to="/Contact">בירור התאמה לעסק <ArrowLeft size={17} /></Link> : <a className="cm-button" href="#download">להורדת האפליקציה <ArrowLeft size={17} /></a>}<Link className="cm-text-link" to={product.slug === 'vessels' ? '/website/guides/vessel-records' : '/website#check'}>{product.slug === 'vessels' ? 'מה לשמור בתיק כלי השיט?' : 'לבדיקת מספר רישוי'} <ArrowLeft size={17} /></Link></div>
    </div>
    <aside className="cm-specialty-aside">
      {product.image ? <img src={`/marketing/${product.image}.webp`} width="645" height="1398" alt="מסך מהאפליקציה עם נתוני הדגמה" /> : <div className="cm-specialty-summary"><span className="cm-kicker">מה קיים ב־Car Reminder</span>{product.highlights?.map(text => <p key={text}><Check size={19} /><span>{text}</span></p>)}<FileText size={30} /><p className="cm-specialty-note">הכלים והמסמכים נשמרים בתיק של כל כלי. היכולות המפורטות כאן מבוססות על המערכת הקיימת.</p></div>}
      {!!related.length && <nav className="cm-related" aria-label="עמודים קשורים"><h2>עוד על ניהול הכלים</h2>{related.map(page => <Link key={page.slug} to={`/website/${page.slug}`}>{page.heading || page.title} <ArrowLeft size={16} /></Link>)}</nav>}
      {!!product.relatedGuides?.length && <nav className="cm-related" aria-label="מדריכים קשורים"><h2>מדריכים שימושיים</h2>{product.relatedGuides.map(slug => <Link key={slug} to={`/website/guides/${slug}`}>{guides.find(guide => guide.slug === slug)?.heading || guides.find(guide => guide.slug === slug)?.title} <ArrowLeft size={16} /></Link>)}</nav>}
    </aside>
  </article>;
}


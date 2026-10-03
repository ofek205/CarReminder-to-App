import React from 'react';
import { Link } from 'react-router-dom';
import {
  CROSS_LINKS,
  TEST_REMINDER_ANSWER,
  TEST_REMINDER_FAQ,
  WAYS,
  buildTestReminderArticle,
  crossLinkFor,
  testReminderFaqJsonLd,
} from '@/lib/testReminderGuide';

const linkStyle = { textDecoration: 'underline', textUnderlineOffset: '3px' };

function WayLink({ part }) {
  if (part.to) {
    return <Link to={part.to} style={linkStyle}>{part.label}</Link>;
  }
  return <a href={part.href} target="_blank" rel="noopener noreferrer" style={linkStyle}>{part.label}</a>;
}

export function TestReminderLead({ rest }) {
  return <>
    {TEST_REMINDER_ANSWER}
    {' '}
    <br />
    <br />
    {rest}
  </>;
}

export function TestReminderWays() {
  return <>
    {WAYS.map((way, index) => (
      <React.Fragment key={way.parts.map(part => part.label || part.text).join('|')}>
        {index > 0 ? <>{' '}<br /></> : null}
        {way.parts.map(part => (
          part.label
            ? <WayLink key={part.label} part={part} />
            : <React.Fragment key={part.text}>{part.text}</React.Fragment>
        ))}
      </React.Fragment>
    ))}
  </>;
}

export function presentGuide(article) {
  if (article?.slug !== 'test-reminder') return article;
  return buildTestReminderArticle(article, {
    lead: <TestReminderLead rest={article.text} />,
    waysBody: <TestReminderWays />,
  });
}

function FaqBlock() {
  const data = testReminderFaqJsonLd();
  return <section className="cm-section cm-faq" aria-label="שאלות נפוצות על תאריך הטסט">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replaceAll('<', '\\u003c') }} />
    <div className="cm-wrap cm-faq-grid">
      <div><span className="cm-kicker">לפני ששומרים את המועד</span><h2>שאלות נפוצות</h2></div>
      <div>{TEST_REMINDER_FAQ.map(([question, answer]) => (
        <details key={question}><summary>{question}</summary><p>{answer}</p></details>
      ))}</div>
    </div>
  </section>;
}

function CrossLink({ link }) {
  return <section className="cm-section">
    <div className="cm-wrap">
      <p>{link.before}<Link to={link.to} style={linkStyle}>{link.label}</Link>{link.after}</p>
    </div>
  </section>;
}

export default function TestReminderAdditions({ article, product }) {
  if (article?.slug === 'test-reminder') return <FaqBlock />;
  const slug = article?.slug || product?.slug;
  const link = CROSS_LINKS[slug] ? crossLinkFor({ article, product }) : null;
  if (!link) return null;
  return <CrossLink link={link} />;
}

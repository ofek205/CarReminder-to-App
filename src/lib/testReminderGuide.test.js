import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { guides, marketingMetadata } from './marketingContent';
import {
  COLLECTOR_URL,
  FEE_HEADING,
  FEE_NOTE,
  TEST_REMINDER_ANSWER,
  TEST_REMINDER_DESCRIPTION,
  TEST_REMINDER_FAQ,
  TEST_REMINDER_HEADING,
  TEST_REMINDER_PATH,
  TEST_REMINDER_TITLE,
  WAYS,
  WAYS_HEADING,
  appendFeeNote,
  buildTestReminderArticle,
  crossLinkFor,
  testReminderFaqJsonLd,
} from './testReminderGuide';

const guide = guides.find(item => item.slug === 'test-reminder');

describe('test-reminder guide copy', () => {
  it('sets the search title and description on the guide entry', () => {
    const meta = marketingMetadata(TEST_REMINDER_PATH);
    expect(meta.title).toBe(`${TEST_REMINDER_TITLE} | Car Reminder`);
    expect(meta.description).toBe(TEST_REMINDER_DESCRIPTION);
    expect(meta.title.length).toBeLessThanOrEqual(60);
    expect(meta.description.length).toBeGreaterThanOrEqual(110);
    expect(meta.description.length).toBeLessThanOrEqual(160);
    expect(guide.heading).toBe(TEST_REMINDER_HEADING);
    expect(guide.heading).toContain('בדיקת תאריך טסט');
  });

  it('keeps the four original sections, including the tuples PR 73 edits', () => {
    expect(guide.sections.map(section => section[0])).toEqual([
      'איפה מוצאים את המועד הנכון?',
      FEE_HEADING,
      'איך שומרים תזכורת שימושית?',
      'מה מעדכנים אחרי החידוש?',
    ]);
    expect(guide.sections[2]).toEqual([
      'איך שומרים תזכורת שימושית?',
      'הוסיפו את המועד לפרטי הרכב ב־Car Reminder. בדקו את הגדרות התזכורת ואת הרשאות ההתראות במכשיר. כדאי לבחור מועד שמאפשר לכם להתארגן מראש, ולא להמתין ליום האחרון.',
    ]);
    expect(guide.sections[3]).toEqual([
      'מה מעדכנים אחרי החידוש?',
      'שמרו את הרישיון המעודכן לצד הרכב ובדקו שהמועד הבא נכון. אם הוזן תאריך אוטומטית, עברו עליו לפני שתסתמכו על התזכורת. כך המסמך והמועד נשארים יחד גם בפעם הבאה שתצטרכו אותם.',
    ]);
    expect(guide.text.startsWith('את מועד חידוש רישיון הרכב בודקים')).toBe(true);
  });

  it('adds the fee pointer without dropping a later link tuple', () => {
    const original = guide.sections[1];
    const withLink = [...original, { to: '/website/child-in-car-reminder', label: 'תזכורת' }];
    const next = appendFeeNote(withLink);
    expect(next[1].startsWith(original[1])).toBe(true);
    expect(next[1].endsWith(FEE_NOTE)).toBe(true);
    expect(next[2]).toEqual(withLink[2]);
    expect(guide.sections[1]).toBe(original);
  });

  it('builds a FAQPage from the same questions that are shown', () => {
    const data = testReminderFaqJsonLd();
    expect(data['@type']).toBe('FAQPage');
    expect(data.mainEntity.map(item => item.name)).toEqual(TEST_REMINDER_FAQ.map(([question]) => question));
    expect(data.mainEntity.map(item => item.acceptedAnswer.text)).toEqual(TEST_REMINDER_FAQ.map(([, answer]) => answer));
    expect(JSON.stringify(data)).not.toContain('AggregateRating');
    expect(JSON.stringify(data)).not.toContain('Article');
    expect(JSON.stringify(data)).not.toContain('BreadcrumbList');
  });

  it('keeps the short answer in the lead and adds the new section after the old ones', () => {
    const built = buildTestReminderArticle(guide, { lead: 'LEAD', waysBody: 'WAYS' });
    expect(built.text).toBe('LEAD');
    expect(built.sections.at(-1)).toEqual([WAYS_HEADING, 'WAYS']);
    expect(built.sections.slice(0, -1).map(section => section[0])).toEqual(guide.sections.map(section => section[0]));
    expect(guide.sections[0][0]).toBe('איפה מוצאים את המועד הנכון?');
    expect(built).not.toBe(guide);
  });

  it('links the three related pages with the requested anchor text', () => {
    expect(crossLinkFor({ product: { slug: 'test-insurance-reminders' } }).label)
      .toBe('איך בודקים מתי הטסט ועד מתי הרישיון בתוקף');
    expect(crossLinkFor({ product: { slug: 'vehicle-lookup' } }).label)
      .toBe('איך בודקים את תוקף רישיון הרכב');
    expect(crossLinkFor({ article: { slug: 'plate-check' } }).label)
      .toBe('בדיקת תאריך טסט ותוקף רישיון');
    expect(crossLinkFor({ article: { slug: 'plate-check' } }).to).toBe(TEST_REMINDER_PATH);
    expect(crossLinkFor({ article: guide })).toBeNull();
  });

  it('mentions the vehicle lookup only as the on-site check, and the collector without field names', () => {
    const collector = WAYS[1];
    expect(collector.parts.some(part => part.href === COLLECTOR_URL)).toBe(true);
    const collectorText = collector.parts.map(part => part.text || part.label).join('');
    expect(collectorText).toContain('אפשר לחפש לפי מספר רישוי ולראות את פרטי הרישוי של הרכב');
    expect(collectorText).not.toContain('מבחן אחרון');
    expect(WAYS[3].parts[0].label).toBe('בבדיקת רכב לפי מספר רישוי כאן באתר');
    expect(WAYS[3].parts[0].to).toBe('/website/vehicle-lookup');
    expect(TEST_REMINDER_ANSWER.length).toBeGreaterThan(40);
  });

  it('has no en dash or em dash in the new copy files', () => {
    for (const file of [
      'src/lib/testReminderGuide.js',
      'src/lib/testReminderGuide.test.js',
      'src/components/TestReminderAdditions.jsx',
    ]) {
      const text = fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
      expect(text).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

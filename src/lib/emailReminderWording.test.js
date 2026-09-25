import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { cwd } from 'node:process';

// emailRender imports the Supabase client; nothing here talks to it.
vi.mock('./supabase', () => ({ supabase: {} }));

const { dueNouns, deriveReminderHeroVars, renderFromTemplateObject } = await import('./emailRender');
const { SYSTEM_PROVIDED, validateTemplate } = await import('./emailValidate');

/**
 * A צמ"ה vehicle has an annual licence, not a test. From 2026-09-25 (Ofek's
 * call) its reminder email says "תוקף רישוי" where a car's says "טסט", like
 * the app and the ministry-sync push.
 *
 * The words are computed twice: by the dispatcher on real sends
 * (supabase/functions/dispatch-reminder-emails) and here, for the admin
 * preview. The last block reads the dispatcher as text and fails if the two
 * tables ever differ.
 */

describe('the words a reminder email uses', () => {
  it('a צמ"ה test reminder', () => {
    expect(dueNouns('reminder_test', 'מלגזה'))
      .toEqual({ dueNoun: 'תוקף רישוי', dueNounDef: 'תוקף הרישוי', subNoun: 'חידוש הרישוי' });
    expect(dueNouns('reminder_test_overdue', 'כלי צמ"ה').dueNounDef).toBe('תוקף הרישוי');
  });

  it('a car, a missing type and an insurance reminder are unchanged', () => {
    expect(dueNouns('reminder_test', 'רכב'))
      .toEqual({ dueNoun: 'טסט', dueNounDef: 'הטסט', subNoun: 'טסט' });
    expect(dueNouns('reminder_test', undefined).dueNoun).toBe('טסט');
    expect(dueNouns('reminder_insurance', 'מלגזה'))
      .toEqual({ dueNoun: 'ביטוח', dueNounDef: 'הביטוח', subNoun: 'ביטוח' });
  });

  it('the hero line reads as Hebrew', () => {
    expect(deriveReminderHeroVars(5, 'reminder_test', 'מלגזה').heroSub).toBe('ימים לחידוש הרישוי');
    expect(deriveReminderHeroVars(1, 'reminder_test', 'מלגזה').heroSub).toBe('יום לחידוש הרישוי');
    expect(deriveReminderHeroVars(0, 'reminder_test', 'מלגזה').heroTop).toBe('תוקף הרישוי פג');
    expect(deriveReminderHeroVars(5, 'reminder_test', 'רכב').heroSub).toBe('ימים לטסט');
    expect(deriveReminderHeroVars(0, 'reminder_test', 'רכב').heroTop).toBe('הטסט פג');
  });

  it('the overdue branch also carries the nouns', () => {
    const v = deriveReminderHeroVars(-3, 'reminder_test_overdue', 'מלגזה');
    expect(v.heroTop).toBe('באיחור');
    expect(v.dueNoun).toBe('תוקף רישוי');
    expect(v.dueNounDef).toBe('תוקף הרישוי');
  });
});

describe('a template that uses {{dueNoun}}', () => {
  const template = {
    notification_key: 'reminder_test',
    subject: 'תזכורת: {{dueNoun}} של {{vehicleName}} {{daysPhrase}}',
    title: '{{dueNounDef}} של {{vehicleName}} מתקרב',
    body_html: '<p>{{dueNounDef}} של {{vehicleName}} בתוקף עד {{expiryDate}}.</p>',
    variables: ['vehicleName', 'daysLeft', 'expiryDate'],
  };
  const vars = { vehicleName: 'המלגזה', daysLeft: '5', expiryDate: '30/09/2026' };

  it('the preview fills it, so nothing is left in braces', () => {
    const r = renderFromTemplateObject(template, { ...vars, vehicleType: 'מלגזה' });
    expect(r.subject).toBe('תזכורת: תוקף רישוי של המלגזה בעוד 5 ימים');
    expect(r.html).toContain('תוקף הרישוי של המלגזה בתוקף עד 30/09/2026.');
    expect(r.html).not.toMatch(/\{\{/);
  });

  it('with no vehicle type the preview shows the car wording', () => {
    expect(renderFromTemplateObject(template, vars).subject).toBe('תזכורת: טסט של המלגזה בעוד 5 ימים');
  });

  it('the editor accepts it without declaring the two variables', () => {
    expect(SYSTEM_PROVIDED.has('dueNoun')).toBe(true);
    expect(SYSTEM_PROVIDED.has('dueNounDef')).toBe(true);
    expect(validateTemplate(template).errors).toEqual([]);
  });
});

describe('the dispatcher uses the same words as the preview', () => {
  const src = fs.readFileSync(
    path.resolve(cwd(), 'supabase/functions/dispatch-reminder-emails/index.ts'), 'utf8');
  const fn = /function dueNouns\([\s\S]*?\r?\n\}/.exec(src)?.[0] || '';
  const returned = [...fn.matchAll(
    /\{ dueNoun: '([^']+)', dueNounDef: '([^']+)', subNoun: '([^']+)' \}/g,
  )].map(([, dueNoun, dueNounDef, subNoun]) => ({ dueNoun, dueNounDef, subNoun }));

  it('insurance, צמ"ה and test, in that order', () => {
    expect(returned).toEqual([
      dueNouns('reminder_insurance'),
      dueNouns('reminder_test', 'מלגזה'),
      dueNouns('reminder_test', 'רכב'),
    ]);
  });

  it('only test reminders look up the vehicle type', () => {
    expect(src).toMatch(/if \(reminderType === 'test' && candidates\?\.length\)/);
  });

  it('the template gets both nouns', () => {
    expect(src).toMatch(/dueNoun, dueNounDef,\r?\n\s+heroTop, heroBig, heroSub,/);
  });
});

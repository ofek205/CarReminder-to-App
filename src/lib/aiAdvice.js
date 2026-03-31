/**
 * AI Advice for vessel issues — uses Anthropic Claude API
 *
 * Usage:
 *   import { getVesselAdvice } from '@/lib/aiAdvice';
 *   const advice = await getVesselAdvice('חלודה בגוף', 'hull', 'חלודה בתחתית הסירה...');
 */

const CATEGORY_LABELS = {
  hull: 'גוף/שלד',
  engine: 'מנוע',
  electrical: 'חשמל',
  plumbing: 'אינסטלציה',
  safety: 'ציוד בטיחות',
  rigging: 'ציוד הפלגה',
  other: 'אחר',
};

/**
 * Get AI-powered advice for a vessel issue.
 * Returns { advice: string } on success or { error: string } on failure.
 */
export async function getVesselAdvice(title, category, description) {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;

  if (!apiKey) {
    return { error: 'מפתח API של Anthropic לא הוגדר. הוסף VITE_ANTHROPIC_API_KEY לקובץ .env' };
  }

  const categoryLabel = CATEGORY_LABELS[category] || category || 'כללי';

  const userMessage = [
    `תקלה בכלי שייט:`,
    `כותרת: ${title}`,
    `קטגוריה: ${categoryLabel}`,
    description ? `תיאור: ${description}` : '',
    '',
    'תן עצה מעשית קצרה (3-5 משפטים) כיצד לאבחן ולטפל בתקלה זו. התמקד בפתרונות מעשיים שבעל סירה יכול לבצע.',
  ].filter(Boolean).join('\n');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512,
        system: 'אתה מומחה לתחזוקת כלי שייט עם ניסיון של 20 שנה. ענה בעברית בלבד. תן עצות מעשיות, בטיחותיות וקצרות.',
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Anthropic API error:', err);
      return { error: 'שגיאה בקבלת ייעוץ. נסה שוב מאוחר יותר.' };
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    return { advice: text };
  } catch (err) {
    console.error('AI advice fetch error:', err);
    return { error: 'שגיאת רשת. בדוק את החיבור לאינטרנט ונסה שוב.' };
  }
}

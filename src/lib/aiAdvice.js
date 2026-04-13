/**
 * AI Advice for vessel issues — uses proxy to avoid exposing API key
 */
import { aiRequest } from './aiProxy';

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
  const categoryLabel = CATEGORY_LABELS[category] || category || 'כללי';

  // Sanitize inputs
  const safeStr = (v) => typeof v === 'string' ? v.replace(/<[^>]*>/g, '').trim().slice(0, 200) : '';

  const userMessage = [
    `תקלה בכלי שייט:`,
    `כותרת: ${safeStr(title)}`,
    `קטגוריה: ${categoryLabel}`,
    description ? `תיאור: ${safeStr(description)}` : '',
    '',
    'תן עצה מעשית קצרה (3-5 משפטים) כיצד לאבחן ולטפל בתקלה זו. התמקד בפתרונות מעשיים שבעל סירה יכול לבצע.',
  ].filter(Boolean).join('\n');

  try {
    const data = await aiRequest({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: 'אתה מומחה לתחזוקת כלי שייט עם ניסיון של 20 שנה. ענה בעברית בלבד. תן עצות מעשיות, בטיחותיות וקצרות.',
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = data.content?.[0]?.text || '';
    return { advice: text.replace(/<[^>]*>/g, '') }; // Strip any HTML from response
  } catch (err) {
    console.error('AI advice fetch error:', err);
    return { error: 'שגיאה בקבלת ייעוץ. נסה שוב מאוחר יותר.' };
  }
}

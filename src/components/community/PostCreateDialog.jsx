import React, { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Camera, X, Loader2, Image as ImageIcon, User, HelpCircle, Car, Ship, ChevronDown, Check, Sparkles } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { db } from '@/lib/supabaseEntities';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { aiRequest } from '@/lib/aiProxy';
import { getVehicleVisual } from '@/lib/designTokens';
import VehicleIcon from '../shared/VehicleIcon';

export default function PostCreateDialog({ open, onClose, domain, vehicles, T }) {
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [linkedVehicleId, setLinkedVehicleId] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [showAnonHelp, setShowAnonHelp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const selectedVehicle = vehicles?.find(v => v.id === linkedVehicleId);
  const queryClient = useQueryClient();

  const reset = () => { setBody(''); setImageUrl(''); setLinkedVehicleId(''); setIsAnonymous(false); };

  const handleImage = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { alert('תמונה גדולה מ-3MB'); return; }
    if (!['image/jpeg', 'image/png'].includes(file.type)) { alert('ניתן להעלות רק JPG/PNG'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => setImageUrl(ev.target.result);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!body.trim() || body.trim().length < 10) { alert('יש לכתוב לפחות 10 תווים'); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const realName = user.user_metadata?.full_name || user.email || 'משתמש';

      let authorName = realName;
      let anonymousNumber = null;

      if (isAnonymous) {
        // Poster is always anonymous #1 in their own thread
        anonymousNumber = 1;
        authorName = `אנונימי #${anonymousNumber}`;
      }

      const post = await db.community_posts.create({
        user_id: user.id, author_name: authorName, domain,
        body: body.trim(), image_url: imageUrl || null,
        linked_vehicle_id: (linkedVehicleId && linkedVehicleId !== 'none') ? linkedVehicleId : null,
        is_anonymous: isAnonymous,
        anonymous_number: anonymousNumber,
      });

      queryClient.invalidateQueries({ queryKey: ['community_posts', domain] });
      reset();
      onClose();

      generateAiResponse(post, linkedVehicleId ? vehicles.find(v => v.id === linkedVehicleId) : null);
    } catch (err) {
      console.error('Post create error:', err);
      alert('שגיאה ביצירת הפוסט: ' + (err?.message || JSON.stringify(err)));
    } finally {
      setSaving(false);
    }
  };

  const generateAiResponse = async (post, vehicle) => {
    try {
      let vehicleContext = '';
      if (vehicle) {
        const details = [];
        if (vehicle.manufacturer) details.push(`יצרן: ${vehicle.manufacturer}`);
        if (vehicle.model) details.push(`דגם: ${vehicle.model}`);
        if (vehicle.year) details.push(`שנה: ${vehicle.year}`);
        if (vehicle.engine_model) details.push(`מנוע: ${vehicle.engine_model}`);
        if (vehicle.engine_cc) details.push(`נפח: ${vehicle.engine_cc}`);
        if (vehicle.horsepower) details.push(`כוח: ${vehicle.horsepower}`);
        if (vehicle.fuel_type) details.push(`דלק: ${vehicle.fuel_type}`);
        if (vehicle.transmission) details.push(`גיר: ${vehicle.transmission}`);
        if (vehicle.current_km) details.push(`ק"מ: ${Number(vehicle.current_km).toLocaleString()}`);
        if (vehicle.current_engine_hours) details.push(`שעות מנוע: ${Number(vehicle.current_engine_hours).toLocaleString()}`);
        if (vehicle.drivetrain) details.push(`כונן: ${vehicle.drivetrain}`);
        if (vehicle.trim_level) details.push(`גימור: ${vehicle.trim_level}`);
        if (vehicle.front_tire) details.push(`צמיגים: ${vehicle.front_tire}`);
        if (vehicle.vehicle_type) details.push(`סוג: ${vehicle.vehicle_type}`);
        vehicleContext = `\n\nפרטי הרכב של השואל:\n${details.join('\n')}`;
      }

      const systemPrompt = domain === 'vessel'
        ? `אתה יוסי, טכנאי כלי שייט מומחה עם 25 שנות ניסיון בישראל. אתה מכיר לעומק את כל סוגי הסירות, המנועים הימיים (Yanmar, Mercury, Volvo Penta), מערכות חשמל ימיות, ואת כל המרינות בישראל.

כללים:
- ענה בעברית בלבד
- אם ניתנו פרטי כלי שייט - התייחס אליהם ספציפית (דגם, מנוע, גודל)
- אם ניתנו שעות מנוע - זה נתון קריטי! התייחס אליו: ציין אם הכלי בקילומטראז'/שעות גבוהות, אילו בדיקות ותחזוקות נדרשות בשלב הזה (למשל: מעל 500 שעות = החלפת אימפלר ובדיקת anodes, מעל 1000 = שיפוץ מנוע אפשרי), והאם הבעיה קשורה לבלאי טבעי בגיל הזה
- תן עצה מעשית ובטיחותית עם הערכת עלות ישראלית
- אל תמציא עובדות - אם אתה לא בטוח, אמור "מומלץ לבדוק עם טכנאי"
- אורך תגובה: 3-6 משפטים מרוכזים`
        : `אתה יוסי המוסכניק, מכונאי רכב ותיק עם 25 שנות ניסיון בישראל. אתה מכיר לעומק את כל דגמי הרכב הנפוצים בישראל, בעיות ידועות לפי דגם ושנה, ומחירי תיקון ישראליים.

כללים:
- ענה בעברית בלבד
- אם ניתנו פרטי רכב - התייחס לדגם הספציפי ולבעיות הידועות שלו
- אם ניתן קילומטראז' - זה נתון קריטי! התייחס אליו: ציין אם הרכב בקילומטראז' גבוה, אילו טיפולים ובדיקות נדרשים בשלב הזה (למשל: מעל 100K = בדיקת רצועת טיימינג, מעל 150K = בדיקת מצמד/תיבת הילוכים, מעל 200K = תשומת לב מוגברת למנוע), והאם הבעיה המתוארת אופיינית לרכב בקילומטראז' הזה
- אם ניתנו שעות מנוע (בעיקר לכלי שטח/משאיות) - התייחס באותו אופן כנתון משמעותי לגבי בלאי ותחזוקה נדרשת
- ציין טווח מחירים ישראלי ריאלי לתיקון (₪)
- הבדל בין דחוף (בטיחותי) לבין משהו שיכול לחכות
- אל תמציא עובדות - אם אתה לא בטוח, אמור "צריך לבדוק במוסך"
- אורך תגובה: 3-6 משפטים מרוכזים`;

      const userMessage = `שאלה מהקהילה:\n"${post.body}"${vehicleContext}`;

      const json = await aiRequest({
        model: 'llama-3.3-70b-versatile', max_tokens: 500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });
      const aiText = json?.content?.[0]?.text || '';
      if (aiText) {
        await supabase.from('community_comments').insert({
          post_id: post.id, user_id: post.user_id,
          author_name: domain === 'vessel' ? '⚓ יוסי מומחה כלי שייט' : '🔧 יוסי המוסכניק',
          body: aiText.replace(/<[^>]*>/g, '').slice(0, 1000), is_ai: true,
        });
        queryClient.invalidateQueries({ queryKey: ['community_comments', post.id] });
        queryClient.invalidateQueries({ queryKey: ['community_comment_counts', domain] });
      }
    } catch (err) { console.error('AI response error:', err); }
  };

  const DomainIcon = domain === 'vessel' ? Ship : Car;
  const isValid = body.trim().length >= 10;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-md mx-4 p-0 overflow-hidden rounded-3xl" dir="rtl" style={{ background: '#fff' }}>
        <VisuallyHidden.Root>
          <DialogTitle>נושא חדש</DialogTitle>
          <DialogDescription>פרסם שאלה או נושא חדש בקהילה</DialogDescription>
        </VisuallyHidden.Root>

        {/* ── Top bar: X | title | avatar ── */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #F3F4F6' }}>
          <button onClick={() => { reset(); onClose(); }}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-[0.95]"
            style={{ background: '#F3F4F6' }}>
            <X className="w-4 h-4" style={{ color: '#6B7280' }} />
          </button>

          <h2 className="text-base font-black" style={{ color: '#1F2937' }}>נושא חדש</h2>

          <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
            style={{ background: isAnonymous ? '#E5E7EB' : T.primary }}>
            {isAnonymous
              ? <User className="w-4 h-4" style={{ color: '#6B7280' }} />
              : <DomainIcon className="w-4 h-4 text-white" />
            }
          </div>
        </div>

        {/* ── Content ── */}
        <div className="px-4 py-4 space-y-3">

          {/* Domain indicator pill */}
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold"
              style={{ background: T.light || '#F3F4F6', color: T.primary }}>
              <DomainIcon className="w-3 h-3" />
              {domain === 'vessel' ? 'פורום כלי שייט' : 'פורום רכבים'}
            </div>
          </div>

          {/* Vehicle picker — at the TOP, like in AI Assistant */}
          {vehicles && vehicles.length > 0 && (
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <button type="button"
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-2xl transition-all active:scale-[0.99]"
                  style={{ background: '#FAFAFA', border: '1px solid #E5E7EB' }}>
                  <div className="flex items-center gap-2 min-w-0">
                    {selectedVehicle ? (() => {
                      const { theme } = getVehicleVisual(selectedVehicle);
                      return (
                        <>
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: theme.light }}>
                            <VehicleIcon vehicle={selectedVehicle} className="w-3.5 h-3.5" style={{ color: theme.primary }} />
                          </div>
                          <div className="text-right min-w-0">
                            <p className="text-[11px] font-bold truncate" style={{ color: '#1F2937' }}>
                              {selectedVehicle.nickname || `${selectedVehicle.manufacturer || ''} ${selectedVehicle.model || ''}`.trim()}
                            </p>
                            <p className="text-[9px]" style={{ color: '#9CA3AF' }}>שואל על הרכב הזה</p>
                          </div>
                        </>
                      );
                    })() : (
                      <>
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#F3F4F6' }}>
                          <Sparkles className="w-3.5 h-3.5" style={{ color: '#6B7280' }} />
                        </div>
                        <div className="text-right">
                          <p className="text-[11px] font-bold" style={{ color: '#1F2937' }}>שאלה כללית</p>
                          <p className="text-[9px]" style={{ color: '#9CA3AF' }}>או בחר רכב ספציפי</p>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {selectedVehicle && (
                      <span onClick={(e) => { e.stopPropagation(); setLinkedVehicleId(''); }}
                        className="w-6 h-6 rounded-full flex items-center justify-center cursor-pointer" style={{ background: '#F3F4F6' }}>
                        <X className="w-3 h-3" style={{ color: '#9CA3AF' }} />
                      </span>
                    )}
                    <ChevronDown className="w-4 h-4" style={{ color: '#9CA3AF' }} />
                  </div>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[calc(100vw-48px)] max-w-sm p-2 rounded-2xl" dir="rtl">
                <div className="space-y-1 max-h-72 overflow-y-auto">
                  <button onClick={() => { setLinkedVehicleId(''); setPickerOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-right transition-all hover:bg-gray-50">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#F3F4F6' }}>
                      <Sparkles className="w-3.5 h-3.5" style={{ color: '#6B7280' }} />
                    </div>
                    <div className="flex-1 text-right">
                      <p className="text-[12px] font-bold" style={{ color: '#1F2937' }}>שאלה כללית</p>
                      <p className="text-[10px]" style={{ color: '#9CA3AF' }}>בלי קישור לרכב מסוים</p>
                    </div>
                    {!selectedVehicle && <Check className="w-4 h-4" style={{ color: T.primary }} />}
                  </button>
                  {vehicles.length > 0 && <div className="my-1 h-px bg-gray-100" />}
                  {vehicles.map(v => {
                    const { theme } = getVehicleVisual(v);
                    const sel = linkedVehicleId === v.id;
                    return (
                      <button key={v.id} onClick={() => { setLinkedVehicleId(v.id); setPickerOpen(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-right transition-all hover:bg-gray-50">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: theme.light }}>
                          <VehicleIcon vehicle={v} className="w-3.5 h-3.5" style={{ color: theme.primary }} />
                        </div>
                        <div className="flex-1 text-right min-w-0">
                          <p className="text-[12px] font-bold truncate" style={{ color: '#1F2937' }}>
                            {v.nickname || `${v.manufacturer || ''} ${v.model || ''}`.trim()}
                          </p>
                          <p className="text-[10px]" style={{ color: '#9CA3AF' }}>
                            {[v.manufacturer, v.year].filter(Boolean).join(' · ')}
                            {v.current_km ? ` · ${Number(v.current_km).toLocaleString()} ק"מ` : ''}
                          </p>
                        </div>
                        {sel && <Check className="w-4 h-4" style={{ color: theme.primary }} />}
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          )}

          {/* Textarea */}
          <div>
            <Textarea value={body} onChange={e => setBody(e.target.value)}
              placeholder="תוכן הנושא" rows={4} maxLength={2000}
              className="text-[14px] resize-none rounded-2xl p-3 focus-visible:ring-0 focus-visible:ring-offset-0"
              style={{ background: '#FAFAFA', border: '1px solid #E5E7EB', minHeight: 120 }} />
            <div className="flex items-center justify-between mt-1 px-1">
              {body.length > 0 && body.length < 10 && (
                <span className="text-[10px]" style={{ color: '#DC2626' }}>מינימום 10 תווים</span>
              )}
              <span className="text-[10px] mr-auto" style={{ color: body.length > 1800 ? '#DC2626' : '#D1D5DB' }}>
                {body.length}/2000
              </span>
            </div>
          </div>

          {/* Anonymous toggle */}
          <div className="rounded-2xl p-3 flex items-center justify-between"
            style={{ background: '#FAFAFA', border: '1px solid #E5E7EB' }}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold" style={{ color: '#1F2937' }}>נושא אנונימי</span>
              <button onClick={() => setShowAnonHelp(s => !s)}
                className="w-5 h-5 rounded-full flex items-center justify-center transition-all"
                style={{ background: '#E5E7EB' }}>
                <HelpCircle className="w-3 h-3" style={{ color: '#9CA3AF' }} />
              </button>
            </div>

            {/* Toggle switch */}
            <button onClick={() => setIsAnonymous(a => !a)}
              className="relative w-11 h-6 rounded-full transition-all"
              style={{ background: isAnonymous ? T.primary : '#D1D5DB' }}>
              <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all"
                style={{ [isAnonymous ? 'left' : 'right']: '2px' }} />
            </button>
          </div>

          {showAnonHelp && (
            <div className="rounded-xl p-3 text-[11px] leading-relaxed"
              style={{ background: '#FFFBEB', border: '1px solid #FEF3C7', color: '#92400E' }}>
              בפרסום אנונימי, השם שלך לא יוצג. במקום זה תופיע התווית "אנונימי #מספר" ייחודי שמבדיל בינך לבין אנונימיים אחרים בפוסט.
            </div>
          )}

          {/* Image upload card */}
          {imageUrl ? (
            <div className="relative rounded-2xl overflow-hidden">
              <img src={imageUrl} alt="" className="w-full object-cover" style={{ maxHeight: '200px' }} />
              <button onClick={() => setImageUrl('')}
                className="absolute top-2 left-2 w-8 h-8 rounded-full bg-black/60 flex items-center justify-center">
                <X className="w-4 h-4 text-white" />
              </button>
            </div>
          ) : (
            <label className="rounded-2xl p-3 flex items-center justify-between cursor-pointer transition-all active:scale-[0.99]"
              style={{ background: '#FAFAFA', border: '1px solid #E5E7EB' }}>
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: T.light || '#EEF2FF' }}>
                  <ImageIcon className="w-4 h-4" style={{ color: T.primary }} />
                </div>
                <span className="text-sm font-bold" style={{ color: '#1F2937' }}>הוספת תמונה</span>
              </div>
              <div className="flex gap-1.5">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: '#F3F4F6' }}>
                  <Camera className="w-4 h-4" style={{ color: '#6B7280' }} />
                </div>
              </div>
              <input type="file" accept="image/jpeg,image/png" className="hidden" onChange={handleImage} />
            </label>
          )}

        </div>

        {/* ── Bottom submit button ── */}
        <div className="px-4 pb-4 pt-1">
          <button onClick={handleSubmit} disabled={!isValid || saving}
            className="w-full py-3.5 rounded-2xl font-bold text-base transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-40"
            style={{
              background: isValid ? (T.grad || T.primary) : '#E5E7EB',
              color: isValid ? '#fff' : '#9CA3AF',
              boxShadow: isValid ? `0 4px 16px ${T.primary}30` : 'none',
            }}>
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : 'פרסום'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Camera, X, Loader2, Image as ImageIcon, User, HelpCircle, Car, Ship, ChevronDown, Check, Sparkles, MessageSquare, ArrowLeft } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { db } from '@/lib/supabaseEntities';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { aiRequest } from '@/lib/aiProxy';
import { getVehicleVisual } from '@/lib/designTokens';
import VehicleIcon from '../shared/VehicleIcon';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import useFormDraft from '@/hooks/useFormDraft';
import FieldError from '../shared/FieldError';
import { toast } from 'sonner';
import { getAiExpertForDomain } from '@/lib/aiExpert';
import { compressImage } from '@/lib/imageCompress';

// Hebrew stop words to filter from search keywords
const STOP_WORDS = new Set(['של', 'את', 'על', 'עם', 'זה', 'אני', 'הוא', 'היא', 'לא', 'כן', 'יש', 'אין', 'מה', 'איך', 'למה', 'כי', 'אם', 'או', 'גם', 'רק', 'עוד', 'כל', 'הם', 'אבל', 'שלי', 'שלך', 'אחרי', 'לפני', 'בין', 'תוך', 'כמו', 'מאוד', 'הרבה', 'קצת']);

const POST_DRAFT_DEFAULT = { body: '', linkedVehicleId: '', isAnonymous: false };

export default function PostCreateDialog({ open, onClose, domain, vehicles, T }) {
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [linkedVehicleId, setLinkedVehicleId] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [showAnonHelp, setShowAnonHelp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [similarPosts, setSimilarPosts] = useState([]);
  const [searchingSimilar, setSearchingSimilar] = useState(false);
  const [similarDismissed, setSimilarDismissed] = useState(false);
  const [bodyError, setBodyError] = useState('');

  // Draft for post body
  const postDraftData = { body, linkedVehicleId, isAnonymous };
  const draft = useFormDraft({
    key: `post_create_${domain}`,
    data: postDraftData,
    setData: (d) => { if (d.body !== undefined) setBody(d.body); if (d.linkedVehicleId !== undefined) setLinkedVehicleId(d.linkedVehicleId); if (d.isAnonymous !== undefined) setIsAnonymous(d.isAnonymous); },
    defaultData: POST_DRAFT_DEFAULT,
    enabled: open,
  });

  const selectedVehicle = vehicles?.find(v => v.id === linkedVehicleId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Search for similar posts as user types
  useEffect(() => {
    if (similarDismissed || !body || body.trim().length < 12) { setSimilarPosts([]); return; }
    const timer = setTimeout(async () => {
      try {
        setSearchingSimilar(true);
        // Extract meaningful keywords (> 2 chars, not stop words)
        const words = body.trim().split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
        if (words.length === 0) { setSimilarPosts([]); return; }
        // Use top 3 keywords
        const keywords = words.slice(0, 3);
        const orFilter = keywords.map(k => `body.ilike.%${k}%`).join(',');
        const { data } = await supabase.from('community_posts').select('id, body, author_name, created_at, is_anonymous, anonymous_number')
          .eq('domain', domain).or(orFilter).order('created_at', { ascending: false }).limit(3);
        setSimilarPosts(data || []);
      } catch { setSimilarPosts([]); }
      finally { setSearchingSimilar(false); }
    }, 500);
    return () => clearTimeout(timer);
  }, [body, domain, similarDismissed]);

  const reset = () => { setBody(''); setImageUrl(''); setLinkedVehicleId(''); setIsAnonymous(false); setSimilarPosts([]); setSimilarDismissed(false); setBodyError(''); };

  const handleImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error('תמונה גדולה מ-10MB'); return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('ניתן להעלות רק JPG/PNG/WebP'); return;
    }
    // Compress before embedding as base64 to cut egress & DB size
    const compressed = await compressImage(file, { maxWidth: 1280, maxHeight: 1280, quality: 0.8 });
    const reader = new FileReader();
    reader.onload = (ev) => setImageUrl(ev.target.result);
    reader.readAsDataURL(compressed);
  };

  const handleSubmit = async () => {
    if (!body.trim() || body.trim().length < 10) { setBodyError('יש לכתוב לפחות 10 תווים'); return; }
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
      draft.clearDraft();
      reset();
      onClose();

      generateAiResponse(post, linkedVehicleId ? vehicles.find(v => v.id === linkedVehicleId) : null);
    } catch (err) {
      console.error('Post create error:', err);
      toast.error('שגיאה ביצירת הפוסט');
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

      const expert = getAiExpertForDomain(domain);
      const systemPrompt = expert.domain === 'vessel'
        ? `אתה ${expert.fullName}, ${expert.role}. אתה מכיר לעומק את כל סוגי הסירות, המנועים הימיים (Yanmar, Mercury, Volvo Penta), מערכות חשמל ימיות, ואת כל המרינות בישראל.

כללים:
- ענה בעברית בלבד
- אם ניתנו פרטי כלי שייט - התייחס אליהם ספציפית (דגם, מנוע, גודל)
- אם ניתנו שעות מנוע - זה נתון קריטי! התייחס אליו: ציין אם הכלי בקילומטראז'/שעות גבוהות, אילו בדיקות ותחזוקות נדרשות בשלב הזה (למשל: מעל 500 שעות = החלפת אימפלר ובדיקת anodes, מעל 1000 = שיפוץ מנוע אפשרי), והאם הבעיה קשורה לבלאי טבעי בגיל הזה
- תן עצה מעשית ובטיחותית עם הערכת עלות ישראלית
- אל תמציא עובדות - אם אתה לא בטוח, אמור "מומלץ לבדוק עם טכנאי"
- אורך תגובה: 3-6 משפטים מרוכזים`
        : `אתה ${expert.fullName}, ${expert.role}. אתה מכיר לעומק את כל דגמי הרכב הנפוצים בישראל, בעיות ידועות לפי דגם ושנה, ומחירי תיקון ישראליים.

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
          author_name: expert.communityName,
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
      <DialogContent className="max-w-md mx-4 p-0 overflow-hidden rounded-3xl" dir="rtl" style={{ background: '#fff', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <VisuallyHidden.Root>
          <DialogTitle>פוסט חדש</DialogTitle>
          <DialogDescription>פרסם פוסט חדש בקהילה</DialogDescription>
        </VisuallyHidden.Root>

        {/* ── Hero gradient header ── */}
        <div className="relative overflow-hidden px-4 pt-4 pb-6"
          style={{ background: T.grad || T.primary }}>
          {/* Decorative circles */}
          <div className="absolute -top-12 -left-12 w-40 h-40 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }} />
          <div className="absolute -bottom-8 -right-8 w-32 h-32 rounded-full" style={{ background: 'rgba(255,191,0,0.15)' }} />

          <div className="relative z-10">
            <div className="flex items-center justify-between mb-3">
              <button onClick={() => { reset(); onClose(); }}
                className="w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-[0.92] hover:bg-white/30"
                style={{ background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(8px)' }}>
                <X className="w-4 h-4 text-white" />
              </button>

              <div className="flex items-center gap-2">
                <DomainIcon className="w-4 h-4 text-white opacity-90" />
                <h2 className="text-lg font-black text-white">
                  {domain === 'vessel' ? 'פוסט חדש - כלי שייט' : 'פוסט חדש - רכבים'}
                </h2>
              </div>

              <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all"
                style={{
                  background: isAnonymous ? 'rgba(255,255,255,0.2)' : '#FFBF00',
                  boxShadow: isAnonymous ? 'none' : '0 2px 12px rgba(255,191,0,0.4)',
                }}>
                {isAnonymous
                  ? <User className="w-4 h-4 text-white" />
                  : <DomainIcon className="w-4 h-4" style={{ color: T.primary }} />
                }
              </div>
            </div>

            <p className="text-xs font-medium text-center" style={{ color: 'rgba(255,255,255,0.85)' }}>
              שתף שאלה או חוויה - הקהילה ו{getAiExpertForDomain(domain).firstName} יענו תוך שניות 🚀
            </p>
          </div>
        </div>

        {/* ── Content ── */}
        <div className="px-4 py-4 space-y-3 -mt-3 relative z-20">


          {/* Vehicle picker — inline expandable (no Popover — works inside Dialog) */}
          {vehicles && vehicles.length > 0 && (
            <div dir="rtl">
              <button type="button" onClick={() => setPickerOpen(o => !o)}
                className="w-full flex items-center justify-between px-3 py-3 rounded-2xl transition-all active:scale-[0.99]"
                style={{ background: '#fff', border: `1.5px solid ${selectedVehicle ? T.primary + '40' : '#E5E7EB'}`, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
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
                  <ChevronDown className={`w-4 h-4 transition-transform ${pickerOpen ? 'rotate-180' : ''}`} style={{ color: '#9CA3AF' }} />
                </div>
              </button>
              {pickerOpen && (
                <div className="mt-1.5 rounded-2xl border overflow-hidden" style={{ background: '#fff', borderColor: '#E5E7EB' }}>
                  <div className="max-h-52 overflow-y-auto overscroll-contain p-1.5 space-y-0.5">
                    <button type="button" onClick={() => { setLinkedVehicleId(''); setPickerOpen(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-right transition-all active:bg-gray-50">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#F3F4F6' }}>
                        <Sparkles className="w-3.5 h-3.5" style={{ color: '#6B7280' }} />
                      </div>
                      <div className="flex-1 text-right">
                        <p className="text-[12px] font-bold" style={{ color: '#1F2937' }}>שאלה כללית</p>
                      </div>
                      {!selectedVehicle && <Check className="w-4 h-4" style={{ color: T.primary }} />}
                    </button>
                    {vehicles.map(v => {
                      const { theme } = getVehicleVisual(v);
                      const sel = linkedVehicleId === v.id;
                      return (
                        <button type="button" key={v.id} onClick={() => { setLinkedVehicleId(v.id); setPickerOpen(false); }}
                          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-right transition-all active:bg-gray-50">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: theme.light }}>
                            <VehicleIcon vehicle={v} className="w-3.5 h-3.5" style={{ color: theme.primary }} />
                          </div>
                          <div className="flex-1 text-right min-w-0">
                            <p className="text-[12px] font-bold truncate" style={{ color: '#1F2937' }}>
                              {v.nickname || `${v.manufacturer || ''} ${v.model || ''}`.trim()}
                            </p>
                            <p className="text-[10px]" style={{ color: '#9CA3AF' }}>
                              {[v.manufacturer, v.year].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                          {sel && <Check className="w-4 h-4 shrink-0" style={{ color: theme.primary }} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Textarea — prominent, with focus glow */}
          <div className="relative">
            <Textarea value={body} onChange={e => { setBody(e.target.value); if (bodyError) setBodyError(''); }}
              placeholder={selectedVehicle ? `על מה תרצה לפרסם בקשר ל-${selectedVehicle.nickname || selectedVehicle.manufacturer || 'הרכב'}?` : 'מה תרצה לפרסם?'}
              rows={4} maxLength={2000}
              className="text-[14px] resize-none rounded-2xl p-4 focus-visible:ring-2 focus-visible:ring-offset-0 transition-all"
              style={{
                background: '#fff',
                border: `1.5px solid ${bodyError ? '#FCA5A5' : body.trim().length > 0 ? T.primary + '60' : '#E5E7EB'}`,
                minHeight: 130,
                boxShadow: body.trim().length > 0 ? `0 0 0 4px ${T.primary}10, 0 1px 4px rgba(0,0,0,0.04)` : '0 1px 4px rgba(0,0,0,0.04)',
              }} />
            <div className="flex items-center justify-between mt-1.5 px-1">
              {body.length > 0 && body.length < 10 && (
                <span className="text-[10px] font-bold flex items-center gap-1" style={{ color: '#DC2626' }}>
                  ⚠️ מינימום 10 תווים ({10 - body.length} נוספים)
                </span>
              )}
              {body.length === 0 && (
                <span className="text-[10px] font-medium" style={{ color: '#9CA3AF' }}>✏️ ספר על הבעיה / השאלה / החוויה</span>
              )}
              <span className="text-[10px] font-bold mr-auto"
                style={{ color: body.length > 1800 ? '#DC2626' : body.length >= 10 ? T.primary : '#D1D5DB' }}>
                {body.length}/2000
              </span>
            </div>
            <FieldError message={bodyError} />
          </div>

          {/* Similar posts — shown while typing */}
          {similarPosts.length > 0 && !similarDismissed && (
            <div className="rounded-2xl p-3 space-y-2 transition-all"
              style={{ background: '#FFFBEB', border: '1.5px solid #FDE68A' }}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold flex items-center gap-1.5" style={{ color: '#92400E' }}>
                  <MessageSquare className="w-3.5 h-3.5" />
                  נמצאו שאלות דומות
                </p>
                <button onClick={() => setSimilarDismissed(true)}
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: '#FEF3C7', color: '#B45309' }}>
                  פרסם בכל זאת
                </button>
              </div>
              {similarPosts.map(sp => (
                <button key={sp.id}
                  onClick={() => { onClose(); reset(); navigate(createPageUrl('Community') + `?post=${sp.id}`); }}
                  className="w-full text-right rounded-xl p-2.5 flex items-start gap-2 transition-all active:scale-[0.98]"
                  style={{ background: '#fff', border: '1px solid #FDE68A' }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate" style={{ color: '#1F2937' }}>
                      {sp.is_anonymous ? `אנונימי${sp.anonymous_number ? ` #${sp.anonymous_number}` : ''}` : sp.author_name}
                    </p>
                    <p className="text-[11px] leading-relaxed mt-0.5 line-clamp-2" style={{ color: '#6B7280' }}>
                      {sp.body?.slice(0, 120)}
                    </p>
                  </div>
                  <ArrowLeft className="w-4 h-4 shrink-0 mt-1" style={{ color: '#D97706' }} />
                </button>
              ))}
            </div>
          )}
          {searchingSimilar && body.trim().length >= 12 && (
            <div className="flex items-center gap-2 px-2">
              <Loader2 className="w-3 h-3 animate-spin" style={{ color: '#D97706' }} />
              <span className="text-[10px] font-medium" style={{ color: '#D97706' }}>מחפש שאלות דומות...</span>
            </div>
          )}

          {/* Anonymous toggle — vibrant card */}
          <div className="rounded-2xl p-3 flex items-center justify-between transition-all"
            style={{
              background: isAnonymous ? '#FFFBEB' : '#fff',
              border: `1.5px solid ${isAnonymous ? '#FDE68A' : '#E5E7EB'}`,
              boxShadow: isAnonymous ? '0 2px 8px rgba(217,119,6,0.15)' : '0 1px 4px rgba(0,0,0,0.04)',
            }}>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                style={{ background: isAnonymous ? '#FDE68A' : '#F3F4F6' }}>
                <User className="w-3.5 h-3.5" style={{ color: isAnonymous ? '#92400E' : '#9CA3AF' }} />
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: isAnonymous ? '#92400E' : '#1F2937' }}>
                  {isAnonymous ? '👤 פוסט אנונימי' : 'פוסט אנונימי'}
                </p>
                {isAnonymous && (
                  <p className="text-[10px] font-medium" style={{ color: '#B45309' }}>השם שלך לא יוצג</p>
                )}
              </div>
              <button onClick={() => setShowAnonHelp(s => !s)}
                className="w-5 h-5 rounded-full flex items-center justify-center transition-all hover:bg-gray-200"
                style={{ background: '#E5E7EB' }}>
                <HelpCircle className="w-3 h-3" style={{ color: '#9CA3AF' }} />
              </button>
            </div>

            {/* Toggle switch */}
            <button onClick={() => setIsAnonymous(a => !a)}
              className="relative w-12 h-7 rounded-full transition-all shrink-0"
              style={{
                background: isAnonymous ? '#D97706' : '#D1D5DB',
                boxShadow: isAnonymous ? 'inset 0 2px 4px rgba(0,0,0,0.15)' : 'inset 0 1px 2px rgba(0,0,0,0.1)',
              }}>
              <div className="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-all"
                style={{ [isAnonymous ? 'left' : 'right']: '2px' }} />
            </button>
          </div>

          {showAnonHelp && (
            <div className="rounded-xl p-3 text-[11px] leading-relaxed"
              style={{ background: '#FFFBEB', border: '1px solid #FEF3C7', color: '#92400E' }}>
              בפרסום אנונימי, השם שלך לא יוצג.
            </div>
          )}

          {/* Image upload card — vibrant gradient when empty */}
          {imageUrl ? (
            <div className="relative rounded-2xl overflow-hidden" style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}>
              <img src={imageUrl} alt="" className="w-full object-cover" style={{ maxHeight: '220px' }} />
              <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
                <span className="px-2.5 py-1 rounded-full text-[10px] font-bold text-white"
                  style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}>
                  ✓ תמונה נטענה
                </span>
                <button onClick={() => setImageUrl('')}
                  className="w-8 h-8 rounded-full bg-black/60 flex items-center justify-center backdrop-blur-sm">
                  <X className="w-4 h-4 text-white" />
                </button>
              </div>
            </div>
          ) : (
            <label className="rounded-2xl p-3 flex items-center justify-between cursor-pointer transition-all active:scale-[0.99] hover:shadow-md"
              style={{
                background: `linear-gradient(135deg, ${T.light || '#F3F4F6'}, #fff)`,
                border: `1.5px dashed ${T.primary}40`,
              }}>
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: T.primary, boxShadow: `0 4px 12px ${T.primary}40` }}>
                  <ImageIcon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-sm font-bold" style={{ color: '#1F2937' }}>הוספת תמונה</p>
                  <p className="text-[10px] font-medium" style={{ color: T.primary }}>📸 גלריה או מצלמה</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:bg-white"
                  style={{ background: 'rgba(255,255,255,0.7)' }}>
                  <Camera className="w-4 h-4" style={{ color: T.primary }} />
                </div>
              </div>
              <input type="file" accept="image/jpeg,image/png" className="hidden" onChange={handleImage} />
            </label>
          )}

        </div>

        {/* ── Bottom submit button — bold gradient with shimmer ── */}
        <div className="px-4 pb-4 pt-2">
          <button onClick={handleSubmit} disabled={!isValid || saving}
            className="w-full py-4 rounded-2xl font-black text-base transition-all active:scale-[0.97] flex items-center justify-center gap-2 disabled:opacity-40 relative overflow-hidden"
            style={{
              background: isValid ? (T.grad || T.primary) : '#E5E7EB',
              color: isValid ? '#fff' : '#9CA3AF',
              boxShadow: isValid ? `0 8px 24px ${T.primary}50, 0 2px 4px ${T.primary}30` : 'none',
            }}>
            {saving ? (
              <><Loader2 className="w-5 h-5 animate-spin" /> מפרסם...</>
            ) : (
              <>
                {isValid && <Sparkles className="w-4 h-4" />}
                {isValid ? 'פרסם פוסט' : `כתוב לפחות 10 תווים${body.length > 0 ? ` (חסרים ${10 - body.length})` : ''}`}
              </>
            )}
          </button>
          {isValid && (() => {
            const e = getAiExpertForDomain(domain);
            return (
              <p className="text-center text-[10px] mt-2 font-medium" style={{ color: '#9CA3AF' }}>
                🤖 {e.fullName} יענה תוך כמה שניות
              </p>
            );
          })()}
        </div>
      </DialogContent>
    </Dialog>
  );
}

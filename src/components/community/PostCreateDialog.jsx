import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Camera, Upload, X, Loader2, Image } from 'lucide-react';
import { db } from '@/lib/supabaseEntities';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { aiRequest } from '@/lib/aiProxy';

export default function PostCreateDialog({ open, onClose, domain, vehicles, T }) {
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [linkedVehicleId, setLinkedVehicleId] = useState('');
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  const reset = () => { setBody(''); setImageUrl(''); setLinkedVehicleId(''); };

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
      const authorName = user.user_metadata?.full_name || user.email || 'משתמש';

      const post = await db.community_posts.create({
        user_id: user.id, author_name: authorName, domain,
        body: body.trim(), image_url: imageUrl || null, linked_vehicle_id: (linkedVehicleId && linkedVehicleId !== 'none') ? linkedVehicleId : null,
      });

      queryClient.invalidateQueries({ queryKey: ['community_posts', domain] });
      reset();
      onClose();

      // AI response in background
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
      // Build rich vehicle context
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
- תן עצה מעשית ובטיחותית עם הערכת עלות ישראלית
- אל תמציא עובדות - אם אתה לא בטוח, אמור "מומלץ לבדוק עם טכנאי"
- אורך תגובה: 3-6 משפטים מרוכזים`
        : `אתה יוסי המוסכניק, מכונאי רכב ותיק עם 25 שנות ניסיון בישראל. אתה מכיר לעומק את כל דגמי הרכב הנפוצים בישראל, בעיות ידועות לפי דגם ושנה, ומחירי תיקון ישראליים.

כללים:
- ענה בעברית בלבד
- אם ניתנו פרטי רכב - התייחס לדגם הספציפי ולבעיות הידועות שלו
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

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-md mx-4 p-0 overflow-hidden" dir="rtl">
        {/* Header */}
        <div className="px-5 pt-5 pb-3">
          <DialogHeader>
            <DialogTitle className="text-lg font-black" style={{ color: '#1F2937' }}>
              {domain === 'vessel' ? '⚓ שאלה חדשה' : '🚗 שאלה חדשה'}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs mt-1" style={{ color: '#9CA3AF' }}>שאל את הקהילה ויוסי יענה תוך שניות</p>
        </div>

        <div className="px-5 pb-5 space-y-3">
          {/* Text input */}
          <div>
            <Textarea value={body} onChange={e => setBody(e.target.value)}
              placeholder="תאר את השאלה או הבעיה שלך..." rows={4} maxLength={2000}
              className="text-[14px] resize-none rounded-xl" style={{ background: '#F9FAFB', border: '1.5px solid #E5E7EB' }} />
            <div className="flex items-center justify-between mt-1 px-1">
              {body.length > 0 && body.length < 10 && (
                <span className="text-[10px]" style={{ color: '#DC2626' }}>מינימום 10 תווים</span>
              )}
              <span className="text-[10px] mr-auto" style={{ color: body.length > 1800 ? '#DC2626' : '#D1D5DB' }}>
                {body.length}/2000
              </span>
            </div>
          </div>

          {/* Image upload */}
          {imageUrl ? (
            <div className="relative rounded-xl overflow-hidden">
              <img src={imageUrl} alt="" className="w-full object-cover" style={{ maxHeight: '200px' }} />
              <button onClick={() => setImageUrl('')}
                className="absolute top-2 left-2 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center">
                <X className="w-4 h-4 text-white" />
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <label className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl cursor-pointer text-[13px] font-medium transition-all active:scale-[0.97]"
                style={{ background: '#F9FAFB', border: '1.5px dashed #D1D5DB', color: '#6B7280' }}>
                <Image className="w-4 h-4" /> הוסף תמונה
                <input type="file" accept="image/jpeg,image/png" className="hidden" onChange={handleImage} />
              </label>
              <label className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl cursor-pointer text-[13px] font-medium transition-all active:scale-[0.97]"
                style={{ background: T.primary, color: '#fff' }}>
                <Camera className="w-4 h-4" />
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImage} />
              </label>
            </div>
          )}

          {/* Vehicle selector */}
          {vehicles && vehicles.length > 0 && (
            <Select value={linkedVehicleId} onValueChange={setLinkedVehicleId}>
              <SelectTrigger className="h-10 text-[13px] rounded-xl" style={{ background: '#F9FAFB', border: '1.5px solid #E5E7EB' }}>
                <SelectValue placeholder={`קשר ל${domain === 'vessel' ? 'כלי שייט' : 'רכב'} (אופציונלי)`} />
              </SelectTrigger>
              <SelectContent dir="rtl">
                <SelectItem value="none">ללא</SelectItem>
                {vehicles.map(v => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.nickname || [v.manufacturer, v.model].filter(Boolean).join(' ')} {v.year ? `(${v.year})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Submit */}
          <button onClick={handleSubmit} disabled={!body.trim() || body.trim().length < 10 || saving}
            className="w-full py-3.5 rounded-full font-bold text-[15px] transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-40"
            style={{ background: T.primary, color: '#fff', boxShadow: `0 4px 16px ${T.primary}30` }}>
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : 'פרסם שאלה'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

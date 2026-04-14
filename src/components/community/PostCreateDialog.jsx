import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Camera, Upload, X, Loader2 } from 'lucide-react';
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

      // 1. Create post
      const post = await db.community_posts.create({
        user_id: user.id,
        author_name: authorName,
        domain,
        body: body.trim(),
        image_url: imageUrl || null,
        linked_vehicle_id: linkedVehicleId || null,
      });

      // 2. Close dialog + refresh feed first (fast UX)
      queryClient.invalidateQueries({ queryKey: ['community_posts', domain] });
      reset();
      onClose();

      // 3. Trigger AI response in background (appears after a few seconds)
      generateAiResponse(post, linkedVehicleId ? vehicles.find(v => v.id === linkedVehicleId) : null);
    } catch (err) {
      console.error('Post create error:', err);
      alert('שגיאה ביצירת הפוסט');
    } finally {
      setSaving(false);
    }
  };

  // AI response runs in background after post is created
  const generateAiResponse = async (post, vehicle) => {
    try {
      let context = `שאלה מפורום ${domain === 'vessel' ? 'כלי שייט' : 'רכבים'}:\n"${post.body}"`;
      if (vehicle) {
        const vInfo = [vehicle.manufacturer, vehicle.model, vehicle.year].filter(Boolean).join(' ');
        context += `\nכלי רכב: ${vInfo}`;
        if (vehicle.engine_model) context += ` | מנוע: ${vehicle.engine_model}`;
        if (vehicle.current_km) context += ` | ${Number(vehicle.current_km).toLocaleString()} ק"מ`;
      }

      const json = await aiRequest({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        system: domain === 'vessel'
          ? 'אתה יוסי, מומחה כלי שייט עם 25 שנות ניסיון בישראל. ענה בעברית, בקצרה ובצורה מעשית. תן עצה מעשית ובטיחותית.'
          : 'אתה יוסי המוסכניק, מכונאי רכב ותיק עם 25 שנות ניסיון בישראל. ענה בעברית, בקצרה ובצורה מעשית. תן עצה שיעזור לפתור את הבעיה.',
        messages: [{ role: 'user', content: context }],
      });

      const aiText = json?.content?.[0]?.text || '';
      if (aiText) {
        // Save as AI comment
        await supabase.from('community_comments').insert({
          post_id: post.id,
          user_id: post.user_id, // use post owner so RLS allows
          author_name: domain === 'vessel' ? '⚓ יוסי מומחה כלי שייט' : '🔧 יוסי המוסכניק',
          body: aiText.replace(/<[^>]*>/g, '').slice(0, 1000),
          is_ai: true,
        });
        queryClient.invalidateQueries({ queryKey: ['community_comments', post.id] });
      }
    } catch (err) {
      console.error('AI response error:', err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-md mx-4" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-lg font-black">
            {domain === 'vessel' ? '⚓ שאלה חדשה — כלי שייט' : '🚗 שאלה חדשה — רכבים'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          {/* Body */}
          <div>
            <Textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="תאר את השאלה או הבעיה שלך..."
              rows={4}
              maxLength={2000}
              className="text-sm resize-none"
            />
            <div className="flex items-center justify-between mt-1 px-1">
              {body.length < 10 && body.length > 0 && (
                <span className="text-[10px] font-medium" style={{ color: '#DC2626' }}>מינימום 10 תווים</span>
              )}
              <span className="text-[10px] mr-auto" style={{ color: body.length > 1800 ? '#DC2626' : '#9CA3AF' }}>
                {body.length}/2000
              </span>
            </div>
          </div>

          {/* Image upload */}
          {imageUrl ? (
            <div className="relative">
              <img src={imageUrl} alt="" className="w-full rounded-xl object-cover" style={{ maxHeight: '200px' }} />
              <button onClick={() => setImageUrl('')}
                className="absolute top-2 left-2 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center">
                <X className="w-4 h-4 text-white" />
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <label className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl cursor-pointer text-xs font-bold transition-all active:scale-[0.97]"
                style={{ background: T.light, color: T.primary, border: `1px solid ${T.border}` }}>
                <Upload className="w-3.5 h-3.5" /> העלה תמונה
                <input type="file" accept="image/jpeg,image/png" className="hidden" onChange={handleImage} />
              </label>
              <label className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl cursor-pointer text-xs font-bold transition-all active:scale-[0.97]"
                style={{ background: T.primary, color: '#fff' }}>
                <Camera className="w-3.5 h-3.5" /> צלם
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImage} />
              </label>
            </div>
          )}

          {/* Optional vehicle link */}
          {vehicles && vehicles.length > 0 && (
            <div>
              <p className="text-xs font-bold mb-1.5" style={{ color: '#6B7280' }}>
                קשר ל{domain === 'vessel' ? 'כלי שייט' : 'רכב'} (אופציונלי)
              </p>
              <Select value={linkedVehicleId} onValueChange={setLinkedVehicleId}>
                <SelectTrigger className="h-10 text-sm">
                  <SelectValue placeholder={`בחר ${domain === 'vessel' ? 'כלי שייט' : 'רכב'}...`} />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  <SelectItem value="">ללא</SelectItem>
                  {vehicles.map(v => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.nickname || [v.manufacturer, v.model].filter(Boolean).join(' ')} {v.year ? `(${v.year})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Submit */}
          <button onClick={handleSubmit} disabled={!body.trim() || body.trim().length < 10 || saving}
            className="w-full py-3 rounded-2xl font-bold text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: T.primary, color: '#fff' }}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'פרסם שאלה'}
          </button>

          <p className="text-[10px] text-center" style={{ color: '#9CA3AF' }}>
            🔧 יוסי המוסכניק יגיב אוטומטית תוך שניות
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

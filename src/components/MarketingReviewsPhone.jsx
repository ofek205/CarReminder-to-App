import React, { useEffect, useState } from 'react';
import { Bell, Bike, Car, FileText, House, Menu, Ship, Smartphone, Sparkles, Star, Truck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import MarketingPhone from './MarketingPhone';

const VEHICLE_ICONS = {
  'רכב': Car,
  'אופנוע': Bike,
  'משאית': Truck,
  'כלי שייט': Ship,
};

function ReviewStars({ rating }) {
  return <span className="cm-review-stars" aria-label={`${rating} מתוך 5 כוכבים`}>
    {[1, 2, 3, 4, 5].map(star => <Star key={star} className={star <= rating ? 'is-filled' : ''} />)}
  </span>;
}

function publicName(name) {
  const parts = String(name || 'משתמש/ת').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || 'משתמש/ת';
  return `${parts[0]} ${parts[1][0]}.`;
}

function ReviewCard({ review }) {
  const VehicleIcon = VEHICLE_ICONS[review.vehicle_type] || Car;
  const SourceIcon = review.user_id ? Smartphone : Sparkles;
  const sourceLabel = review.user_id ? 'מהאפליקציה' : 'הדגמה';
  return <article className="cm-review-card">
    <div className="cm-review-card-head">
      <span className="cm-review-avatar" aria-hidden="true">{review.author_name?.trim()?.[0] || 'מ'}</span>
      <div><strong>{publicName(review.author_name)}</strong><ReviewStars rating={review.rating} /></div>
      <span className="cm-review-source"><SourceIcon /><small>{sourceLabel}</small></span>
    </div>
    {review.title && <h4>{review.title}</h4>}
    <p>{review.body}</p>
    <span className="cm-review-type"><VehicleIcon /> {review.vehicle_type || 'כלי תחבורה'}</span>
  </article>;
}

export default function MarketingReviewsPhone() {
  const [reviews, setReviews] = useState([]);
  const [summary, setSummary] = useState(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let active = true;
    async function loadReviews() {
      try {
        const { data, error } = await supabase
          .from('reviews')
          .select('id, user_id, author_name, rating, title, body, vehicle_type, created_at')
          .order('created_at', { ascending: false })
          .limit(30);
        if (error) throw error;
        if (!active) return;
        const allReviews = (data || []).filter(review => review.body?.trim()).slice(0, 20);
        setReviews(allReviews);
        setSummary({
          count: allReviews.length,
          average: allReviews.length
            ? (allReviews.reduce((sum, review) => sum + review.rating, 0) / allReviews.length).toFixed(1)
            : null,
          fiveStars: allReviews.filter(review => review.rating === 5).length,
          fourStars: allReviews.filter(review => review.rating === 4).length,
        });
        setStatus('ready');
      } catch {
        if (active) setStatus('error');
      }
    }
    loadReviews();
    return () => { active = false; };
  }, []);

  return <MarketingPhone className="cm-reviews-device">
    <div className="cm-reviews-screen" aria-label="חוות דעת שנכתבו ב־Car Reminder">
      <header className="cm-reviews-header">
        <div className="cm-reviews-appbar" aria-hidden="true"><Menu /><strong>חוות דעת משתמשים</strong><Bell /></div>
        {summary?.average && <div className="cm-reviews-summary">
          <div className="cm-reviews-score"><strong>{summary.average}</strong><ReviewStars rating={Math.round(Number(summary.average))} /><span>{summary.count} חוות דעת במערכת</span></div>
          <div className="cm-reviews-bars" aria-hidden="true"><span><b>5</b><i><em style={{ width: `${summary.count ? (summary.fiveStars / summary.count) * 100 : 0}%` }} /></i></span><span><b>4</b><i><em style={{ width: `${summary.count ? (summary.fourStars / summary.count) * 100 : 0}%` }} /></i></span></div>
        </div>}
      </header>
      {status === 'loading' && <div className="cm-review-state" role="status">טוענים חוות דעת…</div>}
      {status === 'error' && <div className="cm-review-state">חוות הדעת זמינות באפליקציה</div>}
      {status === 'ready' && !reviews.length && <div className="cm-review-state">עדיין אין חוות דעת להצגה</div>}
      {!!reviews.length && <div className="cm-review-viewport" tabIndex="0" aria-label="רשימת חוות דעת. האנימציה נעצרת כשהאזור מקבל מיקוד.">
        <div className="cm-review-track">
          <div className="cm-review-loop">{reviews.map(review => <ReviewCard key={review.id} review={review} />)}</div>
          <div className="cm-review-loop" aria-hidden="true">{reviews.map(review => <ReviewCard key={`copy-${review.id}`} review={review} />)}</div>
        </div>
      </div>}
      <div className="cm-reviews-nav" aria-hidden="true"><span><House /><b>ראשי</b></span><span><Car /><b>כלים</b></span><span><FileText /><b>מסמכים</b></span><span className="is-active"><Smartphone /><b>חוות דעת</b></span></div>
    </div>
  </MarketingPhone>;
}

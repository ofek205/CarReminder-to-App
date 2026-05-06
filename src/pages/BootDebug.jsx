/**
 * BootDebug — diagnostic page for the boot pipeline.
 *
 * Renders the persistent boot log captured by `lib/bootDiagnostics.js`
 * with NO dependency on GuestProvider, WorkspaceProvider, AppUpdateGate,
 * Supabase, or any async resource. If you can navigate to /boot-debug
 * even when the rest of the app is hung, you'll see exactly which boot
 * stage fired (and which one didn't) on the failing launch — plus the
 * previous launch's log, in case the current launch never reached this
 * page either.
 *
 * Usage:
 *   1. App is stuck on the loading spinner.
 *   2. Tap "הצג יומן אבחון" in the 7-second recovery overlay
 *      (rendered by main.jsx watchdog), or hit the URL directly.
 *   3. The screen shows a timeline of every boot stage with deltas in ms.
 *   4. The "Copy" button copies the JSON to clipboard so you can paste it
 *      into a bug report or send it via WhatsApp.
 *
 * The page is intentionally NOT wrapped in Layout — Layout pulls in the
 * full provider tree, which is exactly what's failing. Direct render only.
 */
import React from 'react';
import {
  getCurrentBootLog,
  getPreviousBootLog,
  clearBootLogs,
} from '@/lib/bootDiagnostics';

const C = {
  bg:        '#FAFFFE',
  card:      '#FFFFFF',
  border:    '#D8E5D9',
  text:      '#1C2E20',
  muted:     '#6B7280',
  green:     '#2D5233',
  red:       '#DC2626',
  amber:     '#D97706',
  ok:        '#10B981',
};

function StageRow({ entry, prevEntry }) {
  const delta = prevEntry ? entry.t - prevEntry.t : entry.t;
  const slow = delta > 1000;
  return (
    <li
      style={{
        padding: '10px 14px',
        borderBottom: `1px solid ${C.border}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        fontSize: 13,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: C.text, fontFamily: 'ui-monospace,Menlo,monospace' }}>
          {entry.stage}
        </div>
        {entry.extra && Object.keys(entry.extra).length > 0 && (
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2, wordBreak: 'break-all' }}>
            {Object.entries(entry.extra)
              .filter(([k]) => k !== 'ua')
              .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
              .join(' • ')}
          </div>
        )}
      </div>
      <div
        style={{
          fontFamily: 'ui-monospace,Menlo,monospace',
          fontSize: 12,
          fontWeight: 700,
          color: slow ? C.amber : C.green,
          textAlign: 'left',
          direction: 'ltr',
          minWidth: 70,
        }}
      >
        {entry.t} ms
        {prevEntry && (
          <div style={{ fontSize: 10, color: slow ? C.amber : C.muted, fontWeight: 500 }}>
            +{delta} ms
          </div>
        )}
      </div>
    </li>
  );
}

function BootLogSection({ title, log, isCurrent }) {
  const succeeded = log.some(e => e.stage === 'boot_succeeded');
  const lastStage = log[log.length - 1];
  const totalMs = lastStage ? lastStage.t : 0;

  return (
    <section style={{ marginBottom: 24 }}>
      <header style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: C.text, margin: 0 }}>
          {title} {isCurrent && '(הריצה הנוכחית)'}
        </h2>
        <div style={{ fontSize: 11, color: C.muted, fontFamily: 'ui-monospace,Menlo,monospace' }}>
          {log.length} stages • {totalMs} ms
        </div>
      </header>

      {log.length === 0 ? (
        <div
          style={{
            padding: 16,
            background: C.card,
            border: `1px dashed ${C.border}`,
            borderRadius: 12,
            color: C.muted,
            textAlign: 'center',
            fontSize: 13,
          }}
        >
          אין נתונים ביומן זה.
        </div>
      ) : (
        <>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              padding: '6px 12px',
              borderRadius: 999,
              background: succeeded ? '#ECFDF5' : '#FEF2F2',
              color: succeeded ? C.ok : C.red,
              display: 'inline-block',
              marginBottom: 8,
            }}
          >
            {succeeded ? '✓ הסתיים בהצלחה' : '✗ לא הסתיים — נתקע אחרי השלב האחרון'}
          </div>
          <ol
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            {log.map((entry, i) => (
              <StageRow key={i} entry={entry} prevEntry={i > 0 ? log[i - 1] : null} />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

export default function BootDebug() {
  // Render dynamically — not via useState — so the page captures any
  // late-arriving stages if it stays open while the boot continues.
  const [, force] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => force(x => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const current = getCurrentBootLog();
  const previous = getPreviousBootLog();

  const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const isAndroid = /Android/.test(ua);
  const platform = isIos ? 'iOS' : isAndroid ? 'Android' : 'Web';

  const handleCopy = async () => {
    const payload = {
      platform,
      ua,
      url: typeof window !== 'undefined' ? window.location.href : '',
      timestamp: new Date().toISOString(),
      currentLog: current,
      previousLog: previous,
    };
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      alert('היומן הועתק ללוח. אפשר להדביק לשליחה.');
    } catch {
      // Fallback for WKWebView where clipboard API is restricted.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); alert('היומן הועתק.'); }
      catch { alert('העתקה נכשלה — צלם מסך של הדף.'); }
      finally { document.body.removeChild(ta); }
    }
  };

  const handleClear = () => {
    if (!confirm('למחוק את שני היומנים? הריצה הבאה תתחיל ריקה.')) return;
    clearBootLogs();
    force(x => x + 1);
  };

  const handleHome = () => {
    try { window.location.href = '/'; } catch {}
  };

  return (
    <div
      dir="rtl"
      style={{
        minHeight: '100vh',
        background: C.bg,
        padding: '20px 16px 60px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: C.text,
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 6px' }}>
          יומן אבחון פתיחה
        </h1>
        <p style={{ fontSize: 13, color: C.muted, margin: '0 0 20px', lineHeight: 1.6 }}>
          כל שלב במסלול הפתיחה נכתב ל-localStorage באופן סינכרוני. אם
          האפליקציה נתקעת, הדף הזה מראה איפה זה קרה. שלח את היומן (כפתור
          העתקה) כדי שנוכל לאתר את הבעיה.
        </p>

        {/* Platform badge */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999, background: '#E0F2FE', color: '#075985' }}>
            {platform}
          </span>
          <span style={{ fontSize: 11, padding: '4px 10px', borderRadius: 999, background: C.card, border: `1px solid ${C.border}`, color: C.muted, fontFamily: 'ui-monospace,Menlo,monospace', maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ua.slice(0, 80)}
          </span>
        </div>

        <BootLogSection title="ריצה נוכחית" log={current} isCurrent />
        <BootLogSection title="ריצה קודמת" log={previous} />

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <button
            onClick={handleCopy}
            style={{
              flex: '1 1 140px',
              padding: '12px 18px',
              borderRadius: 12,
              background: C.green,
              color: '#fff',
              fontWeight: 700,
              border: 'none',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            העתק יומן
          </button>
          <button
            onClick={handleHome}
            style={{
              flex: '1 1 100px',
              padding: '12px 18px',
              borderRadius: 12,
              background: C.card,
              color: C.green,
              fontWeight: 700,
              border: `1px solid ${C.border}`,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            חזור לדף הבית
          </button>
          <button
            onClick={handleClear}
            style={{
              flex: '1 1 100px',
              padding: '12px 18px',
              borderRadius: 12,
              background: '#FFFFFF',
              color: C.red,
              fontWeight: 700,
              border: `1px solid ${C.red}`,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            מחק יומנים
          </button>
        </div>
      </div>
    </div>
  );
}

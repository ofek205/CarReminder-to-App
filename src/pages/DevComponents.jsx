/**
 * /dev/components — Living style guide for the CarReminder design system.
 *
 * This page is the source of truth for primitives. When you build a new
 * page or migrate an old one, look here first to see how each primitive
 * behaves and which variant is appropriate.
 *
 * NOT shown in any nav — only reachable by typing /dev/components in the URL.
 * Safe to ship to production: no PII, no DB calls, no privileged routes.
 */
import React, { useState } from 'react';
import {
  Plus, Car, Bell, AlertTriangle,
  CheckCircle2, Clock, FileText, Truck, Sparkles, Save,
} from 'lucide-react';
import {
  PageLayout, PageHeader, Hero, Card, CTAButton, StatusPill,
  StatusBar, EmptyState, LoadingState, SkeletonBar,
} from '@/design/primitives';

// Section wrapper used throughout this page. Centralized so future
// changes (e.g. adding "copy code" affordances) happen once.
function Section({ id, title, description, children }) {
  return (
    <section id={id} className="mb-10">
      <header className="mb-3">
        <h2 className="text-cr-xl font-cr-bold text-cr-text-primary">{title}</h2>
        {description && (
          <p className="text-cr-sm text-cr-text-secondary mt-1">{description}</p>
        )}
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

// Sample row showing a swatch + its semantic name + the underlying value.
// Reads from CSS so the swatches stay in sync with tokens.css.
function Swatch({ name, varName }) {
  return (
    <div className="flex items-center gap-3 p-2 rounded-cr-md bg-cr-surface-card border border-cr-border-subtle">
      <div
        className="w-9 h-9 rounded-cr-sm border border-cr-border-default shrink-0"
        style={{ background: `var(${varName})` }}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <p className="text-cr-xs font-cr-semibold text-cr-text-primary truncate">{name}</p>
        <code className="text-[11px] text-cr-text-muted font-mono truncate block" dir="ltr">{varName}</code>
      </div>
    </div>
  );
}

const colorTokens = [
  // Brand
  { name: 'Brand Primary',       varName: '--cr-brand-primary' },
  { name: 'Brand Primary Hover', varName: '--cr-brand-primary-hover' },
  { name: 'Brand Primary Soft',  varName: '--cr-brand-primary-soft' },
  { name: 'Brand Accent',        varName: '--cr-brand-accent' },
  // Surfaces
  { name: 'Surface Canvas',      varName: '--cr-surface-canvas' },
  { name: 'Surface Subtle',      varName: '--cr-surface-subtle' },
  { name: 'Surface Card',        varName: '--cr-surface-card' },
  { name: 'Surface Brand Soft',  varName: '--cr-surface-brand-soft' },
  // Text
  { name: 'Text Primary',        varName: '--cr-text-primary' },
  { name: 'Text Secondary',      varName: '--cr-text-secondary' },
  { name: 'Text Muted',          varName: '--cr-text-muted' },
  { name: 'Text Disabled',       varName: '--cr-text-disabled' },
  // Borders
  { name: 'Border Subtle',       varName: '--cr-border-subtle' },
  { name: 'Border Default',      varName: '--cr-border-default' },
  { name: 'Border Strong',       varName: '--cr-border-strong' },
  // Status
  { name: 'Status OK',           varName: '--cr-status-ok-solid' },
  { name: 'Status Warn',         varName: '--cr-status-warn-solid' },
  { name: 'Status Danger',       varName: '--cr-status-danger-solid' },
  { name: 'Status Info',         varName: '--cr-status-info-solid' },
];

const radiusSamples = [
  { name: 'sm (6px)',   cls: 'rounded-cr-sm'   },
  { name: 'md (10px)',  cls: 'rounded-cr-md'   },
  { name: 'lg (14px)',  cls: 'rounded-cr-lg'   },
  { name: 'xl (20px)',  cls: 'rounded-cr-xl'   },
  { name: '2xl (28px)', cls: 'rounded-cr-2xl'  },
  { name: 'full',       cls: 'rounded-cr-full' },
];

const shadowSamples = [
  { name: 'xs',       cls: 'shadow-cr-xs'       },
  { name: 'sm',       cls: 'shadow-cr-sm'       },
  { name: 'card',     cls: 'shadow-cr-card'     },
  { name: 'md',       cls: 'shadow-cr-md'       },
  { name: 'lg',       cls: 'shadow-cr-lg'       },
  { name: 'floating', cls: 'shadow-cr-floating' },
];

const fontSizes = [
  { label: 'xs (12)',   cls: 'text-cr-xs'   },
  { label: 'sm (14)',   cls: 'text-cr-sm'   },
  { label: 'base (16)', cls: 'text-cr-base' },
  { label: 'lg (18)',   cls: 'text-cr-lg'   },
  { label: 'xl (22)',   cls: 'text-cr-xl'   },
  { label: '2xl (28)',  cls: 'text-cr-2xl'  },
];

const fontWeights = [
  { label: 'regular (400)',  cls: 'font-cr-regular'  },
  { label: 'medium (500)',   cls: 'font-cr-medium'   },
  { label: 'semibold (600)', cls: 'font-cr-semibold' },
  { label: 'bold (700)',     cls: 'font-cr-bold'     },
];

export default function DevComponents() {
  const [activeStatus, setActiveStatus] = useState(null);

  return (
    <PageLayout width="wide">
      <PageHeader
        title="ספרייה / Components"
        subtitle="Living style guide — מקור האמת לעיצוב המערכת"
        icon={Sparkles}
      />

      {/* Quick TOC */}
      <Card variant="subtle" className="mb-8">
        <p className="text-cr-xs font-cr-semibold text-cr-text-secondary mb-2">בעמוד הזה</p>
        <nav className="flex flex-wrap gap-2">
          {[
            ['tokens-colors', 'צבעים'],
            ['tokens-typography', 'טיפוגרפיה'],
            ['tokens-radius-shadow', 'רדיוס + צל'],
            ['p-card', 'Card'],
            ['p-button', 'CTAButton'],
            ['p-status', 'StatusPill / StatusBar'],
            ['p-empty', 'EmptyState'],
            ['p-loading', 'LoadingState'],
            ['p-pageheader', 'PageHeader'],
            ['p-hero', 'Hero'],
          ].map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="px-3 py-1 rounded-cr-full bg-cr-surface-card border border-cr-border-default text-cr-xs font-cr-semibold text-cr-text-primary hover:bg-cr-surface-brand-soft transition-colors"
            >
              {label}
            </a>
          ))}
        </nav>
      </Card>

      {/*  Tokens — Colors  */}
      <Section
        id="tokens-colors"
        title="צבעים סמנטיים"
        description="המקור היחיד לכל גוון. אסור inline hex בקבצי src/pages."
      >
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {colorTokens.map(t => (<Swatch key={t.varName} {...t} />))}
        </div>
      </Section>

      {/*  Tokens — Typography  */}
      <Section
        id="tokens-typography"
        title="טיפוגרפיה"
        description="6 גדלים, 4 משקלים. סוף לערבוב text-[10px] / text-2xl / font-black."
      >
        <Card>
          <p className="text-cr-xs text-cr-text-secondary font-cr-semibold mb-2">גדלים</p>
          <div className="space-y-2">
            {fontSizes.map(f => (
              <div key={f.cls} className="flex items-baseline gap-3">
                <span className="w-28 text-cr-xs text-cr-text-muted font-mono" dir="ltr">{f.cls}</span>
                <span className={`${f.cls} text-cr-text-primary`}>הירש מספר רישוי וקבל תזכורות</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <p className="text-cr-xs text-cr-text-secondary font-cr-semibold mb-2">משקלים</p>
          <div className="space-y-2">
            {fontWeights.map(f => (
              <div key={f.cls} className="flex items-baseline gap-3">
                <span className="w-32 text-cr-xs text-cr-text-muted font-mono" dir="ltr">{f.cls}</span>
                <span className={`text-cr-base text-cr-text-primary ${f.cls}`}>טסט בעוד 3 ימים</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-cr-xs text-cr-text-muted">
            לא נשתמש ב-<code dir="ltr">font-black</code> ולא ב-<code dir="ltr">font-extrabold</code> בקוד חדש.
          </p>
        </Card>
      </Section>

      {/*  Tokens — Radius + Shadow  */}
      <Section id="tokens-radius-shadow" title="Radius + Shadow">
        <Card>
          <p className="text-cr-xs text-cr-text-secondary font-cr-semibold mb-3">Radius</p>
          <div className="flex flex-wrap gap-3">
            {radiusSamples.map(r => (
              <div key={r.cls} className="text-center">
                <div className={`w-16 h-16 bg-cr-brand-primary-soft border border-cr-border-default ${r.cls}`} />
                <p className="text-cr-xs text-cr-text-muted mt-1.5 font-mono" dir="ltr">{r.name}</p>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <p className="text-cr-xs text-cr-text-secondary font-cr-semibold mb-3">Shadow</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {shadowSamples.map(s => (
              <div key={s.cls} className="text-center">
                <div className={`h-16 bg-cr-surface-card border border-cr-border-subtle rounded-cr-md ${s.cls}`} />
                <p className="text-cr-xs text-cr-text-muted mt-1.5 font-mono" dir="ltr">{s.name}</p>
              </div>
            ))}
          </div>
        </Card>
      </Section>

      {/*  Card  */}
      <Section id="p-card" title="Card" description="הקלף הסטנדרטי. שטוח, נקי. ללא gradient.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card variant="default">
            <p className="text-cr-sm font-cr-semibold text-cr-text-primary">default</p>
            <p className="text-cr-xs text-cr-text-secondary mt-1">לבן עם border עדין. ברירת המחדל.</p>
          </Card>
          <Card variant="elevated">
            <p className="text-cr-sm font-cr-semibold text-cr-text-primary">elevated</p>
            <p className="text-cr-xs text-cr-text-secondary mt-1">עם צל קל. שימוש מצומצם.</p>
          </Card>
          <Card variant="subtle">
            <p className="text-cr-sm font-cr-semibold text-cr-text-primary">subtle</p>
            <p className="text-cr-xs text-cr-text-secondary mt-1">רקע אפור עדין. בתוך card אחר.</p>
          </Card>
          <Card variant="brand">
            <p className="text-cr-sm font-cr-semibold text-cr-text-primary">brand</p>
            <p className="text-cr-xs text-cr-text-secondary mt-1">רקע ממותג. למיקומים חשובים.</p>
          </Card>
          <Card variant="outline">
            <p className="text-cr-sm font-cr-semibold text-cr-text-primary">outline</p>
            <p className="text-cr-xs text-cr-text-secondary mt-1">שקוף. רק border.</p>
          </Card>
        </div>
      </Section>

      {/*  CTAButton  */}
      <Section id="p-button" title="CTAButton" description="כפתור CTA יחיד. ללא אימוג'ים. עם פוקוס נראה.">
        <Card>
          <p className="text-cr-xs text-cr-text-secondary font-cr-semibold mb-2">Variants</p>
          <div className="flex flex-wrap gap-2">
            <CTAButton variant="primary"     icon={Plus}>הוסף רכב</CTAButton>
            <CTAButton variant="secondary"   icon={Save}>שמור טיוטה</CTAButton>
            <CTAButton variant="ghost"       icon={Bell}>תזכורות</CTAButton>
            <CTAButton variant="destructive">מחק</CTAButton>
          </div>
        </Card>
        <Card>
          <p className="text-cr-xs text-cr-text-secondary font-cr-semibold mb-2">Sizes</p>
          <div className="flex flex-wrap items-end gap-2">
            <CTAButton size="sm">Small</CTAButton>
            <CTAButton size="md">Medium</CTAButton>
            <CTAButton size="lg">Large</CTAButton>
            <CTAButton size="xl">Extra large</CTAButton>
          </div>
        </Card>
        <Card>
          <p className="text-cr-xs text-cr-text-secondary font-cr-semibold mb-2">States</p>
          <div className="flex flex-wrap gap-2">
            <CTAButton>רגיל</CTAButton>
            <CTAButton loading>טוען</CTAButton>
            <CTAButton disabled>חסום</CTAButton>
            <CTAButton fullWidth icon={Plus}>רוחב מלא</CTAButton>
          </div>
        </Card>
      </Section>

      {/*  StatusPill / StatusBar  */}
      <Section id="p-status" title="StatusPill + StatusBar" description="ה-API היחיד לסטטוסים. ללא hex inline.">
        <Card>
          <p className="text-cr-xs text-cr-text-secondary font-cr-semibold mb-2">StatusPill</p>
          <div className="flex flex-wrap gap-2">
            <StatusPill status="ok">תקין</StatusPill>
            <StatusPill status="warn">בקרוב</StatusPill>
            <StatusPill status="danger">פג תוקף</StatusPill>
            <StatusPill status="info">לידיעה</StatusPill>
            <StatusPill status="warn" size="sm">בעוד 3 ימים</StatusPill>
            <StatusPill status="danger" size="sm">פג לפני 5</StatusPill>
            <StatusPill status="ok" icon={false}>ללא אייקון</StatusPill>
          </div>
        </Card>
        <Card>
          <p className="text-cr-xs text-cr-text-secondary font-cr-semibold mb-3">StatusBar — אינטראקטיבי</p>
          <StatusBar
            activeKey={activeStatus}
            onChange={setActiveStatus}
            items={[
              { key: 'ok',      label: 'תקין',   count: 7, status: 'ok',     icon: CheckCircle2 },
              { key: 'warn',    label: 'בקרוב',  count: 3, status: 'warn',   icon: Clock },
              { key: 'danger',  label: 'באיחור', count: 1, status: 'danger', icon: AlertTriangle },
            ]}
          />
          <p className="text-cr-xs text-cr-text-muted mt-2">
            פעיל: <code dir="ltr">{activeStatus || 'null'}</code>
          </p>
        </Card>
        <Card>
          <p className="text-cr-xs text-cr-text-secondary font-cr-semibold mb-3">StatusBar — 4 פריטים</p>
          <StatusBar
            items={[
              { key: 'all',  label: 'הכל',    count: 11, status: 'info',   icon: Car },
              { key: 'ok',   label: 'תקין',    count: 7,  status: 'ok',     icon: CheckCircle2 },
              { key: 'soon', label: 'בקרוב',   count: 3,  status: 'warn',   icon: Clock },
              { key: 'over', label: 'באיחור',  count: 1,  status: 'danger', icon: AlertTriangle },
            ]}
          />
        </Card>
      </Section>

      {/*  EmptyState  */}
      <Section id="p-empty" title="EmptyState" description="מצבים ריקים סמנטיים. תמיד עם action ברור.">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card variant="outline">
            <EmptyState
              tone="brand"
              icon={Car}
              title="אין עדיין רכבים"
              description="הוסף את הרכב הראשון שלך לפי לוחית — אנחנו ננדב את שאר הפרטים."
              action={<CTAButton variant="primary" icon={Plus}>הוסף רכב</CTAButton>}
            />
          </Card>
          <Card variant="outline">
            <EmptyState
              tone="neutral"
              icon={Bell}
              title="אין התראות"
              description="ההתראות שלך יופיעו כאן כשמועד מסמך או טיפול מתקרב."
            />
          </Card>
          <Card variant="outline">
            <EmptyState
              tone="warning"
              icon={FileText}
              title="חסר מסמך"
              description="העלה רישיון רכב כדי להפעיל תזכורת אוטומטית."
              action={<CTAButton variant="secondary" size="sm">העלה מסמך</CTAButton>}
            />
          </Card>
        </div>
      </Section>

      {/*  LoadingState  */}
      <Section id="p-loading" title="LoadingState" description="ספינר ירוק (לא amber). שלוש וריאנטים.">
        <Card>
          <p className="text-cr-xs text-cr-text-secondary font-cr-semibold mb-2">Page</p>
          <div className="border border-cr-border-subtle rounded-cr-md">
            <LoadingState variant="page" label="טוען רכבים..." />
          </div>
        </Card>
        <Card>
          <p className="text-cr-xs text-cr-text-secondary font-cr-semibold mb-2">Inline</p>
          <p className="text-cr-sm text-cr-text-primary">
            עדכון הרכב <LoadingState variant="inline" label="" /> בעיבוד
          </p>
        </Card>
        <Card>
          <p className="text-cr-xs text-cr-text-secondary font-cr-semibold mb-2">Skeleton</p>
          <div className="space-y-2">
            <SkeletonBar height={20} width="40%" />
            <SkeletonBar height={14} />
            <SkeletonBar height={14} width="80%" />
          </div>
        </Card>
      </Section>

      {/*  PageHeader  */}
      <Section id="p-pageheader" title="PageHeader" description="כותרת דף שטוחה. ללא decorative circles, ללא gradient.">
        <Card variant="outline" className="!p-0 overflow-hidden">
          <div className="px-5">
            <PageHeader
              title="הרכבים שלי"
              subtitle="3 רכבים פעילים"
              icon={Truck}
              actions={<CTAButton size="sm" icon={Plus}>הוסף</CTAButton>}
            />
          </div>
        </Card>
        <Card variant="outline" className="!p-0 overflow-hidden">
          <div className="px-5">
            <PageHeader
              title="עריכת רכב"
              subtitle="מסטה ראשי 2024"
              backTo="Vehicles"
            />
          </div>
        </Card>
      </Section>

      {/*  Hero  */}
      <Section id="p-hero" title="Hero" description="המקום היחיד שבו gradient מותר. לדף הבית ולעדכונים חשובים.">
        <Hero tone="brand">
          <p className="text-cr-xs font-cr-semibold uppercase opacity-80 tracking-wider">דף הבית</p>
          <h2 className="text-cr-2xl font-cr-bold mt-1">בוקר טוב, אופק</h2>
          <p className="text-cr-sm mt-1 opacity-90">3 רכבים פעילים — הכל תקין השבוע.</p>
        </Hero>
        <Hero tone="amber">
          <h2 className="text-cr-xl font-cr-bold">חידוש ביטוח מתקרב</h2>
          <p className="text-cr-sm mt-1 opacity-90">בעוד 8 ימים. נדאג להזכיר לך מחר ובעוד שבוע.</p>
        </Hero>
        <Hero tone="marine">
          <h2 className="text-cr-xl font-cr-bold">כושר שייט בקרוב</h2>
          <p className="text-cr-sm mt-1 opacity-90">ה"שמש" — 14 בנובמבר.</p>
        </Hero>
        <Hero tone="neutral" size="sm">
          <p className="text-cr-sm">tone neutral, size sm — לעדכונים מינוריים.</p>
        </Hero>
      </Section>

      {/*  Footer note  */}
      <Card variant="subtle" className="text-center">
        <p className="text-cr-xs text-cr-text-muted">
          Sprint 1 — Foundation. הספרייה הזאת תמשיך להתעדכן בכל ספרינט.
        </p>
      </Card>
    </PageLayout>
  );
}

import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * <CTAButton> — the one true button.
 *
 * Variants (intent-based):
 *   primary     — main action. Brand green.
 *   secondary   — secondary action. White with brand border.
 *   ghost       — tertiary action. Transparent until hover.
 *   destructive — irreversible action. Red.
 *
 * Sizes:
 *   sm  — 32px tall, dense rows / inline actions
 *   md  — 40px tall, default for forms / cards
 *   lg  — 48px tall, page-level primary CTAs
 *   xl  — 56px tall, hero CTAs / mobile primary
 *
 * Always-on:
 *   - Focus ring (a11y)
 *   - Active scale (haptic feedback)
 *   - Loading state with spinner + disabled
 *   - Optional icon slot (lucide component, not emoji)
 *
 * Voice & tone reminder:
 *   Use imperative verbs: "הוסף רכב" not "נמשיך 🚗"
 *   No emoji in labels. Use the icon prop instead.
 */

const variantClasses = {
  primary:
    'bg-cr-brand-primary text-cr-text-on-brand ' +
    'hover:bg-cr-brand-primary-hover ' +
    'disabled:bg-cr-brand-primary disabled:opacity-50',
  secondary:
    'bg-cr-surface-card text-cr-brand-primary border border-cr-brand-primary ' +
    'hover:bg-cr-surface-brand-soft ' +
    'disabled:opacity-50',
  ghost:
    'bg-transparent text-cr-text-primary ' +
    'hover:bg-cr-surface-subtle ' +
    'disabled:opacity-50',
  destructive:
    'bg-cr-status-danger-solid text-cr-text-on-brand ' +
    'hover:bg-cr-status-danger-fg ' +
    'disabled:bg-cr-status-danger-solid disabled:opacity-50',
};

const sizeClasses = {
  sm: 'h-8 px-3 text-cr-xs gap-1.5',
  md: 'h-10 px-4 text-cr-sm gap-2',
  lg: 'h-12 px-5 text-cr-base gap-2',
  xl: 'h-14 px-6 text-cr-lg gap-2.5',
};

const iconSizes = { sm: 14, md: 16, lg: 18, xl: 20 };

export default function CTAButton({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  disabled = false,
  icon: Icon,
  iconPosition = 'start',  // 'start' | 'end'
  type = 'button',
  className = '',
  children,
  ...rest
}) {
  const v = variantClasses[variant] || variantClasses.primary;
  const s = sizeClasses[size] || sizeClasses.md;
  const isDisabled = disabled || loading;
  const iconSize = iconSizes[size] || iconSizes.md;

  return (
    <button
      type={type}
      disabled={isDisabled}
      className={[
        'inline-flex items-center justify-center',
        'rounded-cr-md font-cr-semibold',
        'transition-all duration-150',
        'active:scale-[0.97]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-cr-border-focus-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:active:scale-100',
        fullWidth ? 'w-full' : '',
        v,
        s,
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      {loading && <Loader2 size={iconSize} className="animate-spin" />}
      {!loading && Icon && iconPosition === 'start' && <Icon size={iconSize} aria-hidden="true" />}
      <span className="truncate">{children}</span>
      {!loading && Icon && iconPosition === 'end' && <Icon size={iconSize} aria-hidden="true" />}
    </button>
  );
}

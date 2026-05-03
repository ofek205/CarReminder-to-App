import React from 'react';

/**
 * <Card> — flat surface with border, used for nearly every container.
 *
 * Variants:
 *   default   — white surface, subtle border, no shadow (the default!)
 *   elevated  — white surface, soft shadow (use sparingly)
 *   subtle    — gray-50 surface, useful inside another card
 *   brand     — branded green-tinted surface for promotional containers
 *   outline   — transparent background, just a border
 *
 * Sizes (controls padding):
 *   sm   — 12px
 *   md   — 16px (default)
 *   lg   — 20px
 *
 * Why no gradient variant?
 *   Gradients are reserved for the <Hero> primitive only. If every
 *   card is a hero, nothing is. Keep this surface flat.
 *
 * Why not a `clickable` variant?
 *   Use a wrapping <Link> or <button>. The card stays a pure container.
 */
const variantClasses = {
  default:  'bg-cr-surface-card border border-cr-border-default',
  elevated: 'bg-cr-surface-card border border-cr-border-subtle shadow-cr-card',
  subtle:   'bg-cr-surface-subtle border border-cr-border-subtle',
  brand:    'bg-cr-surface-brand-soft border border-cr-brand-primary/20',
  outline:  'bg-transparent border border-cr-border-default',
};

const sizeClasses = {
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
};

export default function Card({
  variant = 'default',
  size = 'md',
  className = '',
  children,
  as: Tag = 'div',
  ...rest
}) {
  const v = variantClasses[variant] || variantClasses.default;
  const s = sizeClasses[size] || sizeClasses.md;
  return (
    <Tag className={`rounded-cr-lg ${v} ${s} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

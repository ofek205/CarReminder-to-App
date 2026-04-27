#!/bin/bash
# Builds one consolidated SQL file from all supabase-*.sql files,
# in a deterministic order designed to avoid dependency issues.
# Order: base schema → tables → columns → policies → functions → fixes → seeds
set -e
OUT="staging-init-consolidated.sql"
> "$OUT"
echo "-- ====================================================" >> "$OUT"
echo "-- Consolidated staging init: all production SQL in order" >> "$OUT"
echo "-- Generated: $(date -u +'%Y-%m-%d %H:%M:%S UTC')" >> "$OUT"
echo "-- Run ONCE on the staging branch's SQL editor." >> "$OUT"
echo "-- Some statements may emit 'already exists' errors — safe to ignore." >> "$OUT"
echo "-- ====================================================" >> "$OUT"
echo "" >> "$OUT"

# Phase 1: foundation — base tables + critical fixes + RLS framework
ORDER=(
  supabase-base44-migration.sql
  supabase-rls-policies.sql
  supabase-critical-fixes.sql
  supabase-security-hardening.sql
  supabase-admin-rls-bypass.sql
  supabase-signup-resilience.sql
  supabase-new-user-bootstrap.sql
)
# Phase 2: side tables added later
ORDER+=(
  supabase-add-profiles-table.sql
  supabase-add-app-errors.sql
  supabase-add-community-tables.sql
  supabase-add-contact-messages.sql
  supabase-app-notifications.sql
)
# Phase 3: column additions on existing tables
ORDER+=(
  supabase-add-columns.sql
  supabase-add-missing-vehicle-columns.sql
  supabase-add-spec-columns.sql
  supabase-add-reminder-notify-columns.sql
  supabase-add-service-size-and-tire-count.sql
  supabase-cork-notes-columns.sql
  supabase-engine-type.sql
  supabase-maintenance-prefs.sql
)
# Phase 4: feature SQL
ORDER+=(
  supabase-vessel-checklists.sql
  supabase-vessel-issues.sql
  supabase-checklist-runs.sql
  supabase-custom-checklists.sql
  supabase-clean-checklist-dashes.sql
  supabase-accident-extras.sql
  supabase-accident-extras-fix.sql
  supabase-save-repair-rpc.sql
  supabase-save-repair-accident-link.sql
  supabase-fix-repair-types.sql
  supabase-vehicle-shares.sql
  supabase-vehicle-shares-realtime.sql
  supabase-vehicle-shares-ux.sql
  supabase-vehicle-shares-hardening.sql
  supabase-vehicle-shares-copy.sql
  supabase-vehicle-share-role-edit.sql
  supabase-vehicle-owner-name.sql
  supabase-invite-role-strict.sql
  supabase-notify-invitee-harden.sql
  supabase-fix-member-status.sql
  supabase-add-community-social.sql
  supabase-community-sanitize.sql
  supabase-post-comment-rpc.sql
  supabase-fix-documents-rls.sql
)
# Phase 5: admin + email
ORDER+=(
  supabase-admin-functions.sql
  supabase-admin-popups.sql
  supabase-admin-popups-seed-system.sql
  supabase-ai-provider-settings.sql
  supabase-email-management.sql
  supabase-email-events-versions.sql
  supabase-email-dispatcher.sql
  supabase-email-marketing-broadcasts.sql
  supabase-email-marketing-v2-redesign.sql
  supabase-email-phase4.sql
  supabase-email-remove-dashes.sql
  supabase-delete-account-rpc.sql
)
# Phase 6: seeds last (idempotent)
ORDER+=(
  supabase-seed-community-engagement.sql
  supabase-seed-reviews.sql
)

for f in "${ORDER[@]}"; do
  if [ -f "$f" ]; then
    echo "" >> "$OUT"
    echo "-- ── $f ─────────────────────────────" >> "$OUT"
    echo "" >> "$OUT"
    cat "$f" >> "$OUT"
    echo "" >> "$OUT"
  else
    echo "WARN: $f missing"
  fi
done

LINES=$(wc -l < "$OUT")
SIZE=$(du -h "$OUT" | cut -f1)
echo ""
echo "Built $OUT — $LINES lines, $SIZE"

-- ═══════════════════════════════════════════════════════════════════════════
-- verify-rpcs-preflight-2026-07-24.sql — production gate 5 preflight
--
-- Lists every RPC the shipped client calls and reports the ones the database
-- does NOT have. Any row returned is a screen that will fail in production.
--
-- Why this exists: this repo is not a mirror of the database. There is no
-- migration runner; .sql files are applied by hand, and several are known to
-- have drifted — admin_user_accounts lives only in the database, while
-- supabase-admin-view-as-user-scoped.sql sat committed-but-unapplied from
-- 2026-07-02 to 2026-07-24. Reading the repo cannot answer "is it applied".
-- This asks the database directly.
--
-- Expected result: ZERO ROWS.
-- Regenerate the list with:
--   grep -rhoP "rpc\(\s*['\"]\K[a-z0-9_]+" src --include=*.js --include=*.jsx | sort -u
-- ═══════════════════════════════════════════════════════════════════════════

with called(name) as (values
  ('accept_vehicle_share'),
  ('add_stop_documentation'),
  ('add_vehicle_expense'),
  ('admin_account_details'),
  ('admin_acknowledge_alert'),
  ('admin_action_inbox'),
  ('admin_alert_count_unacknowledged'),
  ('admin_analytics_drilldown'),
  ('admin_analytics_summary'),
  ('admin_audit_log_list'),
  ('admin_current_view'),
  ('admin_delete_account'),
  ('admin_delete_user_full'),
  ('admin_delete_vehicle'),
  ('admin_delete_vehicles'),
  ('admin_end_view'),
  ('admin_force_end_view'),
  ('admin_health_drilldown'),
  ('admin_health_status'),
  ('admin_list_accounts'),
  ('admin_list_business_workspace_requests'),
  ('admin_list_view_sessions'),
  ('admin_phone_coverage'),
  ('admin_popup_stats_7d'),
  ('admin_set_account_owner'),
  ('admin_set_role'),
  ('admin_set_user_note'),
  ('admin_start_view'),
  ('admin_update_vehicle'),
  ('admin_user_accounts'),
  ('admin_user_list'),
  ('admin_vehicle_count_distribution'),
  ('admin_zero_vehicle_cohort_trend'),
  ('approve_business_workspace_request'),
  ('archive_external_driver'),
  ('assign_driver'),
  ('assign_external_driver'),
  ('broadcast_app_update'),
  ('bulk_add_vehicles'),
  ('cancel_pending_invite'),
  ('change_member_role'),
  ('claim_migrated_account'),
  ('create_external_driver'),
  ('create_route_with_stops'),
  ('delete_my_account'),
  ('delete_vehicle_expense'),
  ('delete_vehicle_with_share_choice'),
  ('deny_business_workspace_request'),
  ('driver_log_vehicle_event'),
  ('driver_update_mileage'),
  ('email_stats_recent'),
  ('email_template_publish'),
  ('end_driver_assignment'),
  ('ensure_user_account'),
  ('fn_list_vehicle_expenses'),
  ('fn_vehicle_expense_date_bounds'),
  ('get_app_versions'),
  ('get_email_template'),
  ('get_vehicle_owner_name'),
  ('get_version_distribution'),
  ('invite_account_member_by_email'),
  ('is_admin'),
  ('leave_vehicle_share'),
  ('list_vehicle_shares'),
  ('notify_community_comment'),
  ('notify_vehicle_change'),
  ('post_comment'),
  ('publish_release_announcement'),
  ('redeem_invite_token'),
  ('remove_member'),
  ('report_app_version'),
  ('request_business_workspace'),
  ('revoke_vehicle_share'),
  ('save_repair_with_children'),
  ('set_ai_provider'),
  ('set_email_trigger_enabled'),
  ('share_vehicle_with_email'),
  ('transfer_ownership'),
  ('update_external_driver'),
  ('update_stop_status'),
  ('update_vehicle_expense'),
  ('update_vehicle_share_role'),
  ('workspace_members_directory'),
  ('workspace_team_directory')
)
select c.name as missing_rpc
  from called c
 where not exists (
   select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = c.name
 )
 order by 1;

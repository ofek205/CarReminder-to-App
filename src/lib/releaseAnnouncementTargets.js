/**
 * Targeting for the admin-published "what's new" popup.
 *
 * The server decides who sees it: supabase-release-announcement-platform-
 * target-2026-09-26.sql stores `platforms` on the app_config row and the
 * read policy shows it only to a matching app. These helpers only describe
 * that choice in the admin screen (AdminVersionTab.jsx).
 */
// "What's new" targeting. Order matches the server's (sorted), so a
// comparison against a stored row never differs by order alone.
export const ANN_ALL_PLATFORMS = ['android', 'ios'];
export const ANN_PLATFORM_OPTIONS = [
  { id: 'ios', label: 'אייפון' },
  { id: 'android', label: 'אנדרואיד' },
];

export function annTargets(ann) {
  const p = ann && Array.isArray(ann.platforms) ? ann.platforms : null;
  return p ? ANN_ALL_PLATFORMS.filter((x) => p.includes(x)) : ANN_ALL_PLATFORMS;
}

export function annTargetLabel(platforms) {
  const ios = platforms.includes('ios');
  const android = platforms.includes('android');
  if (ios && android) return 'אייפון ואנדרואיד';
  if (ios) return 'אייפון בלבד';
  if (android) return 'אנדרואיד בלבד';
  return 'אף מכשיר';
}

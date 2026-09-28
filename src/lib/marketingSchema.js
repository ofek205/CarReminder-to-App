// Structured data for the marketing site. Only fields that can be checked
// in this repo are included.
//
// Price is omitted on purpose. The app has a free tier and paid plans, and
// the marketing FAQ says the available plans are shown inside the product.
// applicationCategory is omitted because the repo does not record a store
// category. aggregateRating is omitted because there is no review dataset
// here to cite.

//
// EVERY URL BELOW IS ABSOLUTE, AND THAT IS A RULE, NOT A STYLE. Google rejects
// a BreadcrumbList item whose `item` is relative. Three pages used to carry
// `item: '/website'`, which made their breadcrumb invalid even when a crawler
// did execute the script that injected it.
//
// Everything here is rendered through <MarketingJsonLd>, i.e. into the
// prerendered HTML. It must never be injected from a useEffect: renderToString
// does not run effects, so an effect-injected block is absent from every file
// the prerenderer writes, and three pages lost their FAQPage exactly that way.

export const APPLE_STORE_URL = 'https://apps.apple.com/app/carreminder/id6764073107';
export const GOOGLE_PLAY_URL = 'https://play.google.com/store/apps/details?id=com.carreminder.app';
const SITE_ORIGIN = 'https://car-reminder.app';

// The real app icon, the same 512px file the web manifest ships and the one
// that carries the boat. Not the 128px wordmark, which is under Google's
// preferred logo size and is a different mark.
const LOGO_URL = `${SITE_ORIGIN}/icons/icon-512x512.png`;
// The page's own og:image, so the Article image and the share preview agree.
const ARTICLE_IMAGE = `${SITE_ORIGIN}/marketing/og-main.jpg`;

/**
 * When each guide first went public. Every one of the eight is present in
 * 541aad53, the first commit on `main` to ship the marketing site (PR #16,
 * 2026-09-12): three in marketingSpecialties.js, five in marketingContent.js.
 * Verified from git, not estimated.
 *
 * A guide absent from this map emits NO datePublished. That is the honest
 * default and it is deliberate: a missing date costs a recommended field, a
 * wrong one misstates when the page existed.
 *
 * dateModified is omitted for the same reason. Nothing in this repo records
 * when a guide's text last changed in a way the build can read, and a
 * dateModified that is never updated is a false freshness signal.
 */
const GUIDE_PUBLISHED = {
  'engine-hours': '2026-09-12',
  'equipment-documents': '2026-09-12',
  'collector-status': '2026-09-12',
  'test-reminder': '2026-09-12',
  'vehicle-documents': '2026-09-12',
  'maintenance-log': '2026-09-12',
  'plate-check': '2026-09-12',
  'vessel-records': '2026-09-12',
};
export const guidePublishedDates = GUIDE_PUBLISHED;

function organization() {
  return {
    '@type': 'Organization',
    name: 'Car Reminder',
    url: `${SITE_ORIGIN}/website`,
    logo: LOGO_URL,
    // The two store listings, which are the only external profiles this repo
    // can vouch for. No social accounts are recorded here, so none are listed.
    sameAs: [APPLE_STORE_URL, GOOGLE_PLAY_URL],
  };
}

/** trail: [[name, path], ...]. The last crumb is the current page and gets no URL. */
function breadcrumb(trail) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map(([name, path], index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name,
      ...(path ? { item: `${SITE_ORIGIN}${path}` } : {}),
    })),
  };
}

function faqPage(pairs) {
  return {
    '@type': 'FAQPage',
    mainEntity: pairs.map(([name, text]) => ({ '@type': 'Question', name, acceptedAnswer: { '@type': 'Answer', text } })),
  };
}

export function organizationJsonLd() {
  return { '@context': 'https://schema.org', ...organization() };
}

/**
 * FAQPage for a list of [question, answer] pairs.
 *
 * Kept for correctness, not for a Google rich result: since August 2023
 * Google shows FAQ results only for well-known government and health sites.
 * Bing still renders them, and search assistants read the markup either way.
 * The answers must match what the page visibly shows, so callers pass the same
 * array that renders the <details> list rather than a copy of it.
 */
export function faqJsonLd(pairs) {
  return { '@context': 'https://schema.org', ...faqPage(pairs) };
}

/**
 * A top-level marketing page: a two-step breadcrumb back to /website, plus a
 * FAQPage when the page has one. Used by every product page and by business.
 */
export function pageJsonLd(name, faqs) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      breadcrumb([['Car Reminder', '/website'], [name]]),
      ...(faqs?.length ? [faqPage(faqs)] : []),
    ],
  };
}

export function mobileAppJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'MobileApplication',
    name: 'Car Reminder',
    operatingSystem: 'iOS, Android',
    installUrl: [APPLE_STORE_URL, GOOGLE_PLAY_URL],
  };
}

export function guideJsonLd(article) {
  const name = article.heading || article.title;
  const published = GUIDE_PUBLISHED[article.slug];
  return {
    '@context': 'https://schema.org',
    '@graph': [
      breadcrumb([['Car Reminder', '/website'], ['מדריכים', '/website#guides'], [name]]),
      {
        '@type': 'Article',
        headline: name,
        description: article.description || article.text,
        inLanguage: 'he',
        mainEntityOfPage: `${SITE_ORIGIN}/website/guides/${article.slug}`,
        image: ARTICLE_IMAGE,
        // The guides carry no byline, so the honest author is the publisher.
        // Inventing a named person would be exactly the unverifiable claim
        // this file exists to avoid.
        author: organization(),
        publisher: organization(),
        ...(published ? { datePublished: published } : {}),
      },
    ],
  };
}

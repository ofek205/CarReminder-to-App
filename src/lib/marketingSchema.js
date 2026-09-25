// Structured data for the marketing site. Only fields that can be checked
// in this repo are included.
//
// Price is omitted on purpose. The app has a free tier and paid plans, and
// the marketing FAQ says the available plans are shown inside the product.
// applicationCategory is omitted because the repo does not record a store
// category. aggregateRating is omitted because there is no review dataset
// here to cite.

export const APPLE_STORE_URL = 'https://apps.apple.com/app/carreminder/id6764073107';
export const GOOGLE_PLAY_URL = 'https://play.google.com/store/apps/details?id=com.carreminder.app';
const SITE_ORIGIN = 'https://car-reminder.app';

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
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Car Reminder', item: `${SITE_ORIGIN}/website` },
          { '@type': 'ListItem', position: 2, name: 'מדריכים', item: `${SITE_ORIGIN}/website#guides` },
          { '@type': 'ListItem', position: 3, name },
        ],
      },
      {
        '@type': 'Article',
        headline: name,
        description: article.description || article.text,
        inLanguage: 'he',
        mainEntityOfPage: `${SITE_ORIGIN}/website/guides/${article.slug}`,
        publisher: { '@type': 'Organization', name: 'Car Reminder' },
      },
    ],
  };
}

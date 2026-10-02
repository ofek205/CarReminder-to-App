import React from 'react';

/**
 * Renders a JSON-LD block as part of the component tree, which is the only
 * way structured data reaches the prerendered HTML.
 *
 * Extracted from Marketing.jsx so the child-reminder and landing pages could
 * stop injecting theirs from a useEffect. renderToString does not run effects,
 * so all three of those blocks were missing from every prerendered file and
 * existed only after the browser had executed the bundle. See the header of
 * src/lib/marketingSchema.js.
 *
 * `<` is escaped because a JSON string containing `</script>` would otherwise
 * close the tag early and let the rest of the payload be parsed as HTML.
 */
export default function MarketingJsonLd({ data }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replaceAll('<', '\\u003c') }} />;
}

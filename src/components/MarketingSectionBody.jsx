import React from 'react';
import { Link } from 'react-router-dom';

// A section stays one paragraph. An optional follow-on sentence can link to
// a related marketing page without rewriting the paragraph the crawler test
// matches verbatim.
export default function MarketingSectionBody({ text, link }) {
  return <>
    <p>{text}</p>
    {link ? <p className="cm-context-follow">{link.before}{' '}<Link className="cm-context-link" to={link.to}>{link.label}</Link></p> : null}
  </>;
}

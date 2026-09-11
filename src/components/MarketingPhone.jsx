import React from 'react';
import { BatteryFull, Signal, Wifi } from 'lucide-react';

export default function MarketingPhone({ src, alt, priority = false, children, className = '' }) {
  return <div className={`cm-phone${className ? ` ${className}` : ''}`}>
    <span className="cm-phone-side cm-phone-volume" aria-hidden="true" />
    <span className="cm-phone-side cm-phone-power" aria-hidden="true" />
    <div className="cm-phone-display">
      <div className="cm-phone-status" aria-hidden="true"><span>9:41</span><i className="cm-phone-island" /><span className="cm-phone-status-icons"><Signal /><Wifi /><BatteryFull /></span></div>
      <div className="cm-phone-content">
        {children || <>
          {/* eslint-disable-next-line react/no-unknown-property -- see the note on this attribute in MarketingHeroBackground.jsx */}
          <img src={src} alt={alt} width="645" height="1398" loading={priority ? 'eager' : 'lazy'} fetchpriority={priority ? 'high' : 'auto'} />
        </>}
      </div>
      <div className="cm-phone-home" aria-hidden="true"><span /></div>
    </div>
  </div>;
}

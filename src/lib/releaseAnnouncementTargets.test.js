import { describe, it, expect } from 'vitest';


import { annTargets, annTargetLabel } from './releaseAnnouncementTargets';

describe('release announcement targeting', () => {
  it('a row from before targeting reached every app, so it reads as both', () => {
    expect(annTargets({ id: 'x', body: 'b' })).toEqual(['android', 'ios']);
    expect(annTargets(null)).toEqual(['android', 'ios']);
  });

  it('keeps only known platforms, in the server order', () => {
    expect(annTargets({ platforms: ['ios'] })).toEqual(['ios']);
    expect(annTargets({ platforms: ['ios', 'android'] })).toEqual(['android', 'ios']);
    expect(annTargets({ platforms: ['web', 'android'] })).toEqual(['android']);
  });

  it('labels each target in Hebrew', () => {
    expect(annTargetLabel(['android', 'ios'])).toBe('אייפון ואנדרואיד');
    expect(annTargetLabel(['ios'])).toBe('אייפון בלבד');
    expect(annTargetLabel(['android'])).toBe('אנדרואיד בלבד');
    expect(annTargetLabel([])).toBe('אף מכשיר');
  });
});

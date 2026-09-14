import { describe, expect, it } from 'vitest';
import { AGENT_SURFACES, isAgentSurface } from './ai-tool-surface';

describe('isAgentSurface', () => {
  it('isAgentSurface_acceptsEverySurfaceInTheList', () => {
    for (const surface of AGENT_SURFACES) {
      expect(isAgentSurface(surface)).toBe(true);
    }
  });

  it('isAgentSurface_refusesAnythingElse', () => {
    expect(isAgentSurface('kitchen')).toBe(false);
    expect(isAgentSurface(undefined)).toBe(false);
    expect(isAgentSurface(3)).toBe(false);
  });

  it('AGENT_SURFACES_namesTheApiSurfaceTheValidatorOnceForgot', () => {
    // The request validator enumerated surfaces by hand and never learned `api`, so an API Explorer
    // run was refused as malformed. One list, read by both, is the fix for the pattern.
    expect(AGENT_SURFACES).toContain('api');
    expect(AGENT_SURFACES).toContain('workspace');
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CodeListing } from '@shared/api/code-listing';
import type { JitCaptureResult, JitTier } from '@shared/api/jit-capture';
import { Decoders } from '@shared/angular/services/decoders/decoders';
import { Settings } from '@shared/angular/services/settings/settings';
import {
  GeneratedCode,
  GeneratedCodeResolver,
} from '@features/code/angular/generated-code/generated-code';
import { CodeGeneratedPanel } from './code-generated-panel';

/**
 * Exposes the members of the panel the specs read.
 */
interface PanelInternals {
  mode(): 'static' | 'jit';
}

describe('CodeGeneratedPanel', () => {
  let captures: { path: string; tier: JitTier }[];

  /**
   * Builds the panel, with its template left out — the listing editor is Monaco — and a source
   * file whose generated code is a listing.
   * @param view Generated Code Default View, or undefined for the default.
   * @returns Returns the fixture.
   */
  async function render(view?: 'static' | 'jit'): Promise<ComponentFixture<CodeGeneratedPanel>> {
    const listing: CodeListing = { sections: [] } as unknown as CodeListing;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: GeneratedCodeResolver,
          useValue: {
            resolve: (): Promise<GeneratedCode> =>
              Promise.resolve({
                kind: 'listing',
                listing,
                artifactPath: '/ws/bin/App.dll',
                stale: false,
                matched: true,
              }),
          },
        },
        {
          provide: Decoders,
          useValue: {
            captureJit: (
              path: string,
              _filter: string,
              tier: JitTier,
            ): Promise<JitCaptureResult> => {
              captures.push({ path, tier });
              return Promise.resolve({ ok: false, error: 'Not in a test.' });
            },
          },
        },
      ],
    });
    TestBed.overrideComponent(CodeGeneratedPanel, { set: { template: '', imports: [] } });
    if (view !== undefined) {
      TestBed.inject(Settings).set('textEditor.generatedCodeView', view);
    }
    const fixture: ComponentFixture<CodeGeneratedPanel> =
      TestBed.createComponent(CodeGeneratedPanel);
    fixture.componentRef.setInput('sourcePath', '/ws/src/Program.cs');
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 0));
    return fixture;
  }

  beforeEach(() => {
    captures = [];
    localStorage.removeItem('settings');
  });

  afterEach(() => {
    localStorage.removeItem('settings');
  });

  it('startsOnTheStaticView_byDefault_andCapturesNothing', async () => {
    const fixture: ComponentFixture<CodeGeneratedPanel> = await render();

    expect((fixture.componentInstance as unknown as PanelInternals).mode()).toBe('static');
    expect(captures).toEqual([]);
  });

  it('startsOnTheJitView_whenThatIsTheDefault_andCapturesAsTheListingArrives', async () => {
    const fixture: ComponentFixture<CodeGeneratedPanel> = await render('jit');

    expect((fixture.componentInstance as unknown as PanelInternals).mode()).toBe('jit');
    expect(captures).toEqual([{ path: '/ws/bin/App.dll', tier: 'full-opts' }]);
  });
});

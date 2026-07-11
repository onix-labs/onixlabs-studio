import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConversationContext } from '@shared/api/agent-conversation-channels';
import { BinaryDocumentEntry, BinaryDocuments } from '../../binary-document/binary-document';
import { BinaryPanels } from '../../binary-panels/binary-panels';
import { BinaryAgentPanel } from './binary-agent-panel';

/**
 * Exposes the protected conversation-context signal, so the file scoping can be asserted directly.
 */
interface BinaryAgentPanelInternals {
  fileContext(): ConversationContext | undefined;
}

describe('BinaryAgentPanel', () => {
  let panels: BinaryPanels;

  beforeEach(async () => {
    const documentsStub: Pick<BinaryDocuments, 'get'> = {
      get: (tabId: string): BinaryDocumentEntry | undefined =>
        tabId === 'tab-1' ? ({ path: '/ws/blob.bin' } as BinaryDocumentEntry) : undefined,
    };
    await TestBed.configureTestingModule({
      imports: [BinaryAgentPanel],
      providers: [{ provide: BinaryDocuments, useValue: documentsStub }],
    }).compileComponents();
    panels = TestBed.inject(BinaryPanels);
  });

  /**
   * Creates the panel bound to a tab.
   * @param tabId The owning tab identifier.
   * @returns Returns the settled fixture.
   */
  async function create(tabId: string): Promise<ComponentFixture<BinaryAgentPanel>> {
    const fixture: ComponentFixture<BinaryAgentPanel> = TestBed.createComponent(BinaryAgentPanel);
    fixture.componentRef.setInput('tabId', tabId);
    await fixture.whenStable();
    return fixture;
  }

  it('render_showsTheAgentTitleBarOverTheSharedConversationPanel', async () => {
    const fixture: ComponentFixture<BinaryAgentPanel> = await create('tab-1');
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.binary-agent__title')?.textContent).toContain('Agent');
    expect(host.querySelector('app-agent-conversation-panel')).not.toBeNull();
  });

  it('fileContext_scopesTheConversationToTheBinaryFilePath', async () => {
    const fixture: ComponentFixture<BinaryAgentPanel> = await create('tab-1');
    const internals: BinaryAgentPanelInternals =
      fixture.componentInstance as unknown as BinaryAgentPanelInternals;
    expect(internals.fileContext()).toEqual({ kind: 'file', key: '/ws/blob.bin' });
  });

  it('fileContext_whenTheTabHasNoBinaryDocument_isUndefined', async () => {
    const fixture: ComponentFixture<BinaryAgentPanel> = await create('missing');
    const internals: BinaryAgentPanelInternals =
      fixture.componentInstance as unknown as BinaryAgentPanelInternals;
    expect(internals.fileContext()).toBeUndefined();
  });

  it('close_hidesTheAgentPanelButKeepsItMounted', async () => {
    panels.toggle('tab-1', 'agent');
    const fixture: ComponentFixture<BinaryAgentPanel> = await create('tab-1');

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.binary-agent__bar button')
      ?.click();

    expect(panels.isVisible('tab-1', 'agent')).toBe(false);
    expect(panels.isMounted('tab-1', 'agent')).toBe(true);
  });
});

import { TestBed } from '@angular/core/testing';

import { CodeAgentPanel } from './code-agent-panel';

describe('CodeAgentPanel', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodeAgentPanel],
    }).compileComponents();
  });

  // Constructed without change detection so the embedded agent chat is not rendered (it provides the
  // Agent service and depends on the AI runtime the jsdom test environment does not provide).
  it('create_whenConstructed_returnsComponent', () => {
    const fixture: ReturnType<typeof TestBed.createComponent<CodeAgentPanel>> =
      TestBed.createComponent(CodeAgentPanel);
    fixture.componentRef.setInput('tabId', 'tab-1');
    expect(fixture.componentInstance).toBeTruthy();
  });
});

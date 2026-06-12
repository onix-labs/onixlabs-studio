import { TestBed } from '@angular/core/testing';

import { CodeTerminalPanel } from './code-terminal-panel';

describe('CodeTerminalPanel', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodeTerminalPanel],
    }).compileComponents();
  });

  // Constructed without change detection so the embedded terminal view is not rendered (it depends on
  // the Electron terminal bridge and browser layout the jsdom test environment does not provide).
  it('create_whenConstructed_returnsComponent', () => {
    const fixture: ReturnType<typeof TestBed.createComponent<CodeTerminalPanel>> =
      TestBed.createComponent(CodeTerminalPanel);
    fixture.componentRef.setInput('tabId', 'tab-1');
    expect(fixture.componentInstance).toBeTruthy();
  });
});

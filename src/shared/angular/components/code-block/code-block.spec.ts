import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TerminalLaunch, TerminalSessions } from '@shared/angular/services/terminal-sessions/terminal-sessions';
import { CodeBlock } from './code-block';

/**
 * A stub terminal-sessions host recording the launches the play action requests.
 */
class FakeTerminals {
  public readonly launched: { name: string; kind: string; command: string }[] = [];

  public isRooted(): boolean {
    return true;
  }

  public launch(options: { name: string; kind: string; command: string }): Promise<TerminalLaunch> {
    this.launched.push(options);
    return Promise.resolve({} as TerminalLaunch);
  }
}

@Component({
  imports: [CodeBlock],
  template: `<app-code-block [code]="code()" [lang]="lang()" />`,
})
class TestHost {
  public readonly code: WritableSignal<string> = signal<string>('npm test');
  public readonly lang: WritableSignal<string> = signal<string>('bash');
}

/**
 * Builds the fixture, optionally providing a terminal host.
 * @param terminals The terminal host to provide, or null to omit it.
 * @returns Returns the host fixture and element.
 */
function build(terminals: FakeTerminals | null): {
  fixture: ComponentFixture<TestHost>;
  host: HTMLElement;
} {
  TestBed.configureTestingModule({
    imports: [TestHost],
    providers: terminals === null ? [] : [{ provide: TerminalSessions, useValue: terminals }],
  });
  const fixture: ComponentFixture<TestHost> = TestBed.createComponent(TestHost);
  fixture.detectChanges();
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

describe('CodeBlock', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows the code', () => {
    const { host } = build(null);
    expect(host.querySelector('code')?.textContent).toBe('npm test');
  });

  it('shows the language label in the footer', () => {
    const { host } = build(null);
    expect(host.querySelector('.code-block__lang')?.textContent).toBe('bash');
  });

  it('offers a play button for a shell language', () => {
    const { host } = build(new FakeTerminals());
    expect(host.querySelector('[aria-label="Run in terminal"]')).not.toBeNull();
  });

  it('does not offer play for a non-shell language', () => {
    const terminals: FakeTerminals = new FakeTerminals();
    TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [{ provide: TerminalSessions, useValue: terminals }],
    });
    const fixture: ComponentFixture<TestHost> = TestBed.createComponent(TestHost);
    fixture.componentInstance.lang.set('typescript');
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[aria-label="Run in terminal"]'),
    ).toBeNull();
  });

  it('hides play when the terminal host is not rooted in a view', () => {
    const unrooted: FakeTerminals = new FakeTerminals();
    (unrooted as unknown as { isRooted: () => boolean }).isRooted = (): boolean => false;
    const { host } = build(unrooted);
    expect(host.querySelector('[aria-label="Run in terminal"]')).toBeNull();
  });

  it('launches the command in a run terminal when played', () => {
    const terminals: FakeTerminals = new FakeTerminals();
    const { host } = build(terminals);
    host.querySelector<HTMLElement>('[aria-label="Run in terminal"]')!.click();
    expect(terminals.launched).toEqual([{ name: 'Run: npm test', kind: 'run', command: 'npm test' }]);
  });
});

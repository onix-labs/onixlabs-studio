import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LspServer, LspStatus } from '../../../../services/lsp/lsp-status';
import { ActiveWorkspace } from '../../../../services/workspace/active-workspace';
import { LspStatusMenu } from './lsp-status-menu';

describe('LspStatusMenu', () => {
  let fixture: ComponentFixture<LspStatusMenu>;
  let status: LspStatus;
  let rootPath: WritableSignal<string | null>;

  beforeEach(async () => {
    rootPath = signal<string | null>(null);
    await TestBed.configureTestingModule({
      imports: [LspStatusMenu],
      providers: [{ provide: ActiveWorkspace, useValue: { rootPath } }],
    }).compileComponents();

    status = TestBed.inject(LspStatus);
    fixture = TestBed.createComponent(LspStatusMenu);
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('render_whenActiveWorkspaceHasNoServers_showsNoTrigger', () => {
    status.register('/root::java', { serverId: 'java', rootPath: '/root', restart: (): void => undefined });
    rootPath.set('/other');
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.lsp-status-menu__trigger')).toBeNull();
  });

  it('render_showsTheActiveWorkspacesStartingServer', () => {
    status.register('/root::java', { serverId: 'java', rootPath: '/root', restart: (): void => undefined });
    rootPath.set('/root');
    fixture.detectChanges();

    const trigger: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      '.lsp-status-menu__trigger',
    );
    expect(trigger?.textContent).toContain('Java Language Server');
    expect(trigger?.textContent).toContain('starting');
  });

  it('render_whenSeveralServers_summarisesTheCount', () => {
    status.register('/root::java', { serverId: 'java', rootPath: '/root', restart: (): void => undefined });
    status.register('/root::typescript', {
      serverId: 'typescript',
      rootPath: '/root',
      restart: (): void => undefined,
    });
    rootPath.set('/root');
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.lsp-status-menu__trigger')?.textContent,
    ).toContain('2 Language Servers');
  });

  it('restart_delegatesToTheStatusRegistry', () => {
    let calls: number = 0;
    status.register('/root::java', {
      serverId: 'java',
      rootPath: '/root',
      restart: (): void => {
        calls += 1;
      },
    });
    status.setState('/root::java', 'ready');
    rootPath.set('/root');
    fixture.detectChanges();

    const server: LspServer = status.servers()[0];
    (fixture.componentInstance as unknown as { restart(server: LspServer): void }).restart(server);

    expect(calls).toBe(1);
  });
});

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LspServer, LspStatus } from '@shared/angular/services/lsp/lsp-status';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';
import { StatusStripLspMenu } from './status-strip-lsp-menu';

describe('StatusStripLspMenu', () => {
  let fixture: ComponentFixture<StatusStripLspMenu>;
  let status: LspStatus;
  let rootPath: WritableSignal<string | null>;

  beforeEach(async () => {
    rootPath = signal<string | null>(null);
    await TestBed.configureTestingModule({
      imports: [StatusStripLspMenu],
      providers: [{ provide: ActiveWorkspace, useValue: { rootPath } }],
    }).compileComponents();

    status = TestBed.inject(LspStatus);
    fixture = TestBed.createComponent(StatusStripLspMenu);
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('render_whenActiveWorkspaceHasNoServers_showsNoTrigger', () => {
    status.register('/root::java', {
      serverId: 'java',
      rootPath: '/root',
      restart: (): void => undefined,
    });
    rootPath.set('/other');
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.lsp-status-menu__trigger'),
    ).toBeNull();
  });

  it('render_whenActiveWorkspaceHasServers_showsTheTrigger', () => {
    status.register('/root::java', {
      serverId: 'java',
      rootPath: '/root',
      restart: (): void => undefined,
    });
    rootPath.set('/root');
    fixture.detectChanges();

    const trigger: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      '.lsp-status-menu__trigger',
    );
    // The trigger is a static icon that opens the menu; each server's own name and state live in the
    // menu it opens rather than on the trigger.
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute('title')).toBe('Language Servers');
  });

  it('statusText_ofAReadyServerThatSaysSomethingIsWrong_saysWhat (#1210)', () => {
    const server: LspServer = {
      sessionId: '/root::rust',
      serverId: 'rust',
      name: 'rust-analyzer',
      rootPath: '/root',
      state: 'ready',
      stalled: false,
      problem: 'Failed to load workspaces.',
    };
    const menu: { statusText(server: LspServer): string } = fixture.componentInstance as never;

    expect(menu.statusText(server)).toBe('Failed to load workspaces.');
    expect(menu.statusText({ ...server, problem: undefined })).toBe('Ready');
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

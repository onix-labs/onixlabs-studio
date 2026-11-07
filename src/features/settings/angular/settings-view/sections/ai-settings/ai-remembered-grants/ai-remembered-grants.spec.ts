import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Ai } from '@shared/angular/services/ai/ai';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import type { AiPermissionGrant, AiRevokePermissionGrant } from '@shared/api/ai-types';
import { AiRememberedGrants } from './ai-remembered-grants';

describe('AiRememberedGrants', () => {
  /**
   * The fake client's state.
   */
  let grants: AiPermissionGrant[];

  /**
   * What the fake client was asked to revoke.
   */
  let revoked: AiRevokePermissionGrant[];

  /**
   * What the fake client answers a revoke with.
   */
  let saved: boolean;

  /**
   * Renders the list and lets it load.
   * @returns Returns the element.
   */
  async function render(): Promise<HTMLElement> {
    const fixture: ComponentFixture<AiRememberedGrants> =
      TestBed.createComponent(AiRememberedGrants);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * Waits for a click's revoke and reload to finish.
   * @returns Resolves when they have.
   */
  async function settled(): Promise<void> {
    await TestBed.inject(Ai).client?.listPermissionGrants();
    await new Promise<void>((resolve: () => void): void => void setTimeout(resolve));
    TestBed.tick();
  }

  beforeEach((): void => {
    grants = [
      {
        key: 'start_worker',
        tool: 'start_worker',
        command: null,
        workspaceRoot: null,
        grantedAt: null,
      },
      {
        key: 'Bash\u0000ls -la',
        tool: 'Bash',
        command: 'ls -la',
        workspaceRoot: '/repo',
        grantedAt: '2026-11-01T12:00:00.000Z',
      },
    ];
    revoked = [];
    saved = true;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Ai,
          useValue: {
            client: {
              listPermissionGrants: (): Promise<readonly AiPermissionGrant[]> =>
                Promise.resolve([...grants]),
              revokePermissionGrant: (request: AiRevokePermissionGrant): Promise<boolean> => {
                revoked.push(request);
                grants = grants.filter(
                  (grant: AiPermissionGrant): boolean => grant.key !== request.key,
                );
                return Promise.resolve(saved);
              },
            },
          },
        },
      ],
    });
  });

  it('listsEachGrant_withWhatItCovers_itsScope_andWhenItWasMade', async () => {
    const host: HTMLElement = await render();
    const rows: readonly HTMLElement[] = Array.from(host.querySelectorAll('tbody tr'));

    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('start_worker (any use)');
    expect(rows[0].textContent).toContain('Everywhere');
    expect(rows[0].textContent).toContain('Before 2026-11');
    expect(rows[1].textContent).toContain('Bash: ls -la');
    expect(rows[1].textContent).toContain('/repo');
    expect(rows[1].textContent).toContain(
      new Date('2026-11-01T12:00:00.000Z').toLocaleDateString(),
    );
  });

  it('revoke_namesTheGrantAndItsScope_andTheListFollows', async () => {
    const host: HTMLElement = await render();

    host.querySelectorAll<HTMLElement>('tbody tr')[1].querySelector('button')?.click();
    await settled();

    expect(revoked).toEqual([{ key: 'Bash\u0000ls -la', workspaceRoot: '/repo' }]);
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(TestBed.inject(Notifications).toasts()).toEqual([]);
  });

  it('revoke_saysSo_whenItCouldNotBeSaved', async () => {
    saved = false;
    const host: HTMLElement = await render();

    host.querySelector<HTMLElement>('tbody tr button')?.click();
    await settled();

    expect(TestBed.inject(Notifications).toasts()[0].severity).toBe('error');
  });

  it('saysSo_whenNothingIsRemembered', async () => {
    grants = [];

    const host: HTMLElement = await render();

    expect(host.textContent).toContain('No remembered permissions.');
  });
});

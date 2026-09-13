import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  InjectionToken,
  Injector,
  input,
  InputSignal,
  Signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ScopedOutlet } from '@shared/angular/components/scoped-outlet/scoped-outlet';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Stands in for anything a secondary window provides of its own — in production the CDK overlay
 * container, whose value decides which window a menu opens in.
 */
const SCOPE: InjectionToken<string> = new InjectionToken<string>('SCOPE', {
  providedIn: 'root',
  factory: (): string => 'root',
});

/**
 * Reports the scope it resolves, which is the whole measurement.
 */
@Component({
  selector: 'app-scope-probe',
  template: '{{ scope }}',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class ScopeProbe {
  /**
   * Gets the scope resolved at this component's position.
   */
  public readonly scope: string = inject(SCOPE);
}

/**
 * Stands in for `ModalWindowHost`: it provides the scoped value and renders a template it was handed
 * with its own injector. Crucially it is NOT an ancestor of that template's declaration site, which
 * is what makes a modal window different from an inline overlay.
 */
@Component({
  selector: 'app-scope-host',
  imports: [NgTemplateOutlet],
  template: `<ng-container [ngTemplateOutlet]="content()" [ngTemplateOutletInjector]="injector" />`,
  providers: [{ provide: SCOPE, useValue: 'window' }],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class ScopeHost {
  /**
   * Gets the caller's content.
   */
  public readonly content: InputSignal<TemplateRef<unknown>> =
    input.required<TemplateRef<unknown>>();

  /**
   * Gets this host's injector, which the content is rendered with.
   */
  public readonly injector: Injector = inject(Injector);
}

/**
 * Stands in for the Mission Control tile: it declares the content template, and that template renders
 * a second template through an outlet — the shape that loses the scope.
 */
@Component({
  selector: 'app-scope-subject',
  imports: [NgTemplateOutlet, ScopedOutlet, ScopeProbe, ScopeHost],
  template: `
    <ng-template #contentTemplate>
      <span class="direct"><app-scope-probe /></span>
      <span class="plain"><ng-container [ngTemplateOutlet]="nested" /></span>
      <span class="scoped"><ng-container [appScopedOutlet]="nested" /></span>
    </ng-template>
    <ng-template #nested><app-scope-probe /></ng-template>
    <app-scope-host [content]="content()" />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class ScopeSubject {
  /**
   * Gets the template handed to the host.
   */
  public readonly content: Signal<TemplateRef<unknown>> =
    viewChild.required<TemplateRef<unknown>>('contentTemplate');
}

describe('ScopedOutlet', () => {
  let element: HTMLElement;

  beforeEach(() => {
    const fixture: ComponentFixture<ScopeSubject> = TestBed.createComponent(ScopeSubject);
    fixture.detectChanges();
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
  });

  it('resolvesTheHostsScope_forContentWrittenDirectlyInTheTemplate', () => {
    // The baseline. `ngTemplateOutletInjector` covers the view it creates, so this much already
    // worked — and is why the defect was invisible until something was nested.
    expect(element.querySelector('.direct')?.textContent).toBe('window');
  });

  it('losesTheHostsScope_throughAPlainNestedOutlet', () => {
    // 🔥 The defect, pinned. This is not a quirk of the test: an embedded view resolves through its
    // declaration site, and a nested `ngTemplateOutlet` supplies no fallback of its own. In
    // production the value is the CDK overlay container, so this reads as a menu opening in the
    // wrong window.
    expect(element.querySelector('.plain')?.textContent).toBe('root');
  });

  it('carriesTheHostsScope_throughANestedScopedOutlet', () => {
    // The fix: the directive captures the injector of the position it occupies, which is inside the
    // enclosing embedded view and therefore already resolves the host's scope.
    expect(element.querySelector('.scoped')?.textContent).toBe('window');
  });
});

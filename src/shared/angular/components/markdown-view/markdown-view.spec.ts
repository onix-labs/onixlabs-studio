import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MarkdownView } from './markdown-view';

@Component({
  imports: [MarkdownView],
  template: `<app-markdown-view [text]="text()" />`,
})
class TestHost {
  public readonly text: WritableSignal<string> = signal<string>('');
}

describe('MarkdownView', () => {
  let fixture: ComponentFixture<TestHost>;
  let component: TestHost;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TestHost] }).compileComponents();
    fixture = TestBed.createComponent(TestHost);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
  });

  it('renders prose as HTML', () => {
    component.text.set('Hello **world**');
    fixture.detectChanges();
    const prose: HTMLElement | null = host.querySelector('.markdown-view__prose');
    expect(prose?.querySelector('strong')?.textContent).toBe('world');
  });

  it('renders a fenced code block as a code-block component', () => {
    component.text.set('```bash\nnpm test\n```');
    fixture.detectChanges();
    expect(host.querySelector('app-code-block')).not.toBeNull();
    expect(host.querySelector('app-code-block code')?.textContent).toBe('npm test');
  });

  it('keeps prose and code as separate ordered blocks', () => {
    component.text.set('Before\n\n```js\nconst a = 1;\n```\n\nAfter');
    fixture.detectChanges();
    expect(host.querySelectorAll('.markdown-view__prose').length).toBe(2);
    expect(host.querySelectorAll('app-code-block').length).toBe(1);
  });

  it('renders inline math through KaTeX', () => {
    component.text.set('The identity $x^2$ is quadratic.');
    fixture.detectChanges();
    expect(host.querySelector('.markdown-view__prose .katex')).not.toBeNull();
  });

  it('renders nothing for empty text', () => {
    component.text.set('');
    fixture.detectChanges();
    expect(host.querySelector('.markdown-view__prose')).toBeNull();
    expect(host.querySelector('app-code-block')).toBeNull();
  });
});

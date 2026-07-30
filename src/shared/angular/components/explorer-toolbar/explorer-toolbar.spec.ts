import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ExplorerToolbar } from './explorer-toolbar';

describe('ExplorerToolbar', () => {
  let component: ExplorerToolbar;
  let fixture: ComponentFixture<ExplorerToolbar>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExplorerToolbar],
    }).compileComponents();

    fixture = TestBed.createComponent(ExplorerToolbar);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('render_showsTheQueryAndPlaceholderInTheSearchBox', () => {
    fixture.componentRef.setInput('query', 'main');
    fixture.componentRef.setInput('searchPlaceholder', 'Search files');
    fixture.detectChanges();

    const input: HTMLInputElement = host.querySelector<HTMLInputElement>(
      '.explorer-toolbar__search input',
    )!;
    expect(input.value).toBe('main');
    expect(input.placeholder).toBe('Search files');
    expect(input.getAttribute('aria-label')).toBe('Search files');
  });

  it('typing_emitsTheQueryChangeOutput', () => {
    fixture.detectChanges();
    const emitted: string[] = [];
    component.queryChange.subscribe((value: string): void => void emitted.push(value));

    const input: HTMLInputElement = host.querySelector<HTMLInputElement>(
      '.explorer-toolbar__search input',
    )!;
    input.value = 'readme';
    input.dispatchEvent(new Event('input'));

    expect(emitted).toEqual(['readme']);
  });

  it('expandAllButton_emitsTheExpandAllIntent', () => {
    fixture.detectChanges();
    let expanded: number = 0;
    component.expandAll.subscribe((): void => void (expanded += 1));

    host.querySelector<HTMLButtonElement>('[aria-label="Expand All"]')?.click();

    expect(expanded).toBe(1);
  });

  it('collapseAllButton_emitsTheCollapseAllIntent', () => {
    fixture.detectChanges();
    let collapsed: number = 0;
    component.collapseAll.subscribe((): void => void (collapsed += 1));

    host.querySelector<HTMLButtonElement>('[aria-label="Collapse All"]')?.click();

    expect(collapsed).toBe(1);
  });
});

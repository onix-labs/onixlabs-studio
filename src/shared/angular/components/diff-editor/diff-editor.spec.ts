import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DiffEditor } from './diff-editor';

describe('DiffEditor', () => {
  let fixture: ComponentFixture<DiffEditor>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DiffEditor],
    }).compileComponents();

    fixture = TestBed.createComponent(DiffEditor);
    fixture.componentRef.setInput('original', 'before');
    fixture.componentRef.setInput('modified', 'after');
    fixture.componentRef.setInput('language', 'plaintext');
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('render_mountsTheMonacoHostElement', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.diff-editor')).not.toBeNull();
  });

  it('api_beforeTheEditorIsCreated_reportsNoInstance', () => {
    // Monaco does not load under the test runner, so the engine is never created; the imperative API
    // stays null-safe.
    expect(fixture.componentInstance.getDiffEditor()).toBeNull();
  });
});

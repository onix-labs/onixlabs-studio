import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TextEditor } from './text-editor';

describe('TextEditor', () => {
  let fixture: ComponentFixture<TextEditor>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TextEditor],
    }).compileComponents();

    fixture = TestBed.createComponent(TextEditor);
    fixture.componentRef.setInput('content', 'hello');
    fixture.componentRef.setInput('language', 'plaintext');
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('render_mountsTheMonacoHostElement', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.text-editor')).not.toBeNull();
  });

  it('api_beforeTheEditorIsCreated_reportsNoInstance', () => {
    // Monaco does not load under the test runner, so the engine is never created; the imperative API
    // stays null-safe.
    expect(fixture.componentInstance.getEditor()).toBeNull();
    expect(fixture.componentInstance.getModelUri()).toBeNull();
    expect(fixture.componentInstance.getValue()).toBe('');
  });
});

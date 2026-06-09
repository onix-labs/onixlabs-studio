import { ComponentFixture, TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  let fixture: ComponentFixture<App>;
  let element: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();

    fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  });

  it('create_whenBootstrapped_returnsComponentInstance', () => {
    const app: App = fixture.componentInstance;

    expect(app).toBeTruthy();
  });

  it('render_whenInitialised_displaysProductTitle', () => {
    const heading: HTMLHeadingElement | null = element.querySelector('h1');

    expect(heading?.textContent).toContain('ONIXLabs Studio');
  });

  it('render_whenInitialised_displaysProductTagline', () => {
    const tagline: HTMLParagraphElement | null = element.querySelector('p');

    expect(tagline?.textContent).toContain(
      'A modern cross-platform integrated development environment',
    );
  });
});

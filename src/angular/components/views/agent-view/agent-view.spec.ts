import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AgentView } from './agent-view';

describe('AgentView', () => {
  let component: AgentView;
  let fixture: ComponentFixture<AgentView>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentView],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentView);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

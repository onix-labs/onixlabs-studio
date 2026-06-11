import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AgentRibbon } from './agent-ribbon';

describe('AgentRibbon', () => {
  let component: AgentRibbon;
  let fixture: ComponentFixture<AgentRibbon>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentRibbon],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentRibbon);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

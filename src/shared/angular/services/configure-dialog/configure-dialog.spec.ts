import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ConfigureDialog } from './configure-dialog';

describe('ConfigureDialog', () => {
  it('isClosedInitially', () => {
    const dialog: ConfigureDialog = TestBed.inject(ConfigureDialog);
    expect(dialog.isOpen()).toBe(false);
  });

  it('open_showsTheDialog', () => {
    const dialog: ConfigureDialog = TestBed.inject(ConfigureDialog);
    dialog.open();
    expect(dialog.isOpen()).toBe(true);
  });

  it('close_hidesTheDialog', () => {
    const dialog: ConfigureDialog = TestBed.inject(ConfigureDialog);
    dialog.open();
    dialog.close();
    expect(dialog.isOpen()).toBe(false);
  });
});

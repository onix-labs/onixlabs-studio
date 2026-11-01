import { TestBed } from '@angular/core/testing';

import { Settings } from '@shared/angular/services/settings/settings';
import { Theme } from '@shared/angular/services/theme/theme';
import {
  PendingSettingsImport,
  SettingsFile,
  SettingsFileRead,
  SettingsTransfer,
} from './settings-transfer';

describe('SettingsTransfer', () => {
  let transfer: SettingsTransfer;
  let settings: Settings;

  /**
   * Builds the text of a settings file carrying the given settings.
   * @param entries The settings the file carries.
   * @param version The file format version.
   * @returns Returns the file text.
   */
  function fileText(entries: Record<string, unknown>, version: number = 1): string {
    return JSON.stringify({
      format: 'onixlabs-studio-settings',
      version,
      exportedAt: '2026-10-30T00:00:00.000Z',
      settings: entries,
    });
  }

  /**
   * Parses a settings file, failing the test when it is refused.
   * @param text The file text.
   * @returns Returns the checked import.
   */
  function accepted(text: string): PendingSettingsImport {
    const read: SettingsFileRead = transfer.parse('studio-settings.json', text);
    if (!read.ok) {
      throw new Error(read.error);
    }
    return read.pending;
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    transfer = TestBed.inject(SettingsTransfer);
    settings = TestBed.inject(Settings);
  });

  it('buildExport_carriesWhatTheUserChanged_andNotTheDefaults', () => {
    settings.set('textEditor.global.fontSize', 18);

    const file: SettingsFile = transfer.buildExport();

    expect(file.format).toBe('onixlabs-studio-settings');
    expect(file.settings['textEditor.global.fontSize']).toBe(18);
    expect('textEditor.global.tabSize' in file.settings).toBe(false);
  });

  it('buildExport_carriesTheSettingsOtherServicesOwn', () => {
    TestBed.inject(Theme).setMode('dark');

    expect(transfer.buildExport().settings['appearance.themeMode']).toBe('dark');
  });

  it('parse_whenNotJson_refusesTheFile', () => {
    const read: SettingsFileRead = transfer.parse('notes.txt', 'not json');

    expect(read.ok).toBe(false);
  });

  it('parse_whenNotASettingsExport_refusesTheFile', () => {
    const read: SettingsFileRead = transfer.parse('package.json', '{"name":"x"}');

    expect(read).toEqual({ ok: false, error: 'package.json is not a Studio settings export.' });
  });

  it('parse_whenWrittenByANewerStudio_refusesTheFile', () => {
    const read: SettingsFileRead = transfer.parse('future.json', fileText({}, 99));

    expect(read.ok).toBe(false);
  });

  it('parse_skipsUnknownKeysAndValuesThatDoNotFit', () => {
    const pending: PendingSettingsImport = accepted(
      fileText({
        'textEditor.global.fontSize': 16,
        'textEditor.global.wordWrap': 'yes please',
        'markdownEditor.printMargin': 'enormous',
        'no.such.setting': true,
      }),
    );

    expect(pending.owned['textEditor.global.fontSize']).toBe(16);
    expect(transfer.countOf(pending)).toBe(1);
    expect(pending.skipped).toBe(3);
  });

  it('parse_carriesRetiredKeysForward', () => {
    // A file from before the print margin moved to each capability still sets both.
    const pending: PendingSettingsImport = accepted(
      fileText({ 'application.printMargin': 'wide' }),
    );

    expect(pending.owned['textEditor.printMargin']).toBe('wide');
    expect(pending.owned['markdownEditor.printMargin']).toBe('wide');
    expect(transfer.countOf(pending)).toBe(2);
    expect(pending.skipped).toBe(0);
  });

  it('apply_whenKeeping_leavesSettingsTheFileDoesNotMention', () => {
    settings.set('textEditor.global.tabSize', 8);

    transfer.apply(accepted(fileText({ 'textEditor.global.fontSize': 16 })), false);

    expect(settings.get('textEditor.global.fontSize')).toBe(16);
    expect(settings.get('textEditor.global.tabSize')).toBe(8);
  });

  it('apply_whenResetting_returnsSettingsTheFileDoesNotMentionToDefault', () => {
    const defaultTabSize: number = settings.get('textEditor.global.tabSize');
    settings.set('textEditor.global.tabSize', 8);

    transfer.apply(accepted(fileText({ 'textEditor.global.fontSize': 16 })), true);

    expect(settings.get('textEditor.global.fontSize')).toBe(16);
    expect(settings.get('textEditor.global.tabSize')).toBe(defaultTabSize);
  });

  it('apply_writesSettingsOtherServicesOwnThroughTheirOwner', () => {
    transfer.apply(accepted(fileText({ 'appearance.themeMode': 'light' })), false);

    expect(TestBed.inject(Theme).mode()).toBe('light');
  });

  it('roundTrip_exportThenImport_restoresTheSameSettings', () => {
    settings.set('terminal.defaultShell', '/bin/zsh');
    const text: string = JSON.stringify(transfer.buildExport());
    settings.set('terminal.defaultShell', '');

    transfer.apply(accepted(text), true);

    expect(settings.get('terminal.defaultShell')).toBe('/bin/zsh');
  });
});

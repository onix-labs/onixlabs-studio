import { HostName } from '@shared/api/network-names-channels';
import { HostNameBook } from './host-name-book';

describe('HostNameBook', () => {
  let time: number;
  let book: HostNameBook;
  let heard: (readonly HostName[])[];

  beforeEach((): void => {
    time = 1_000_000;
    book = new HostNameBook((): number => time, 3);
    heard = [];
    book.onLearned((names: readonly HostName[]): void => void heard.push(names));
  });

  it('aCaptureName_beatsAReverseOne_whicheverCameFirst', () => {
    book.learn('140.82.113.25', 'lb-140-82-113-25-iad.github.com', 'reverse', 60_000);
    book.learn('140.82.113.25', 'api.github.com', 'capture', 60_000);

    const overwritten: boolean = book.learn('140.82.113.25', 'lb.github.com', 'reverse', 60_000);

    expect(overwritten).toBe(false);
    expect(book.lookup('140.82.113.25')).toEqual(
      expect.objectContaining({ name: 'api.github.com', source: 'capture' }),
    );
  });

  it('aNewerCaptureName_replacesAnOlderOne', () => {
    book.learn('1.2.3.4', 'a.example', 'capture', 60_000);

    book.learn('1.2.3.4', 'b.example', 'capture', 60_000);

    expect(book.lookup('1.2.3.4')?.name).toBe('b.example');
  });

  it('forgetsANameOnceItExpires_andThenTakesAReverseOne', () => {
    book.learn('1.2.3.4', 'a.example', 'capture', 60_000);
    time += 60_000;

    expect(book.lookup('1.2.3.4')).toBeUndefined();
    expect(book.learn('1.2.3.4', 'ptr.example', 'reverse', 60_000)).toBe(true);
    expect(book.lookup('1.2.3.4')?.source).toBe('reverse');
  });

  it('keysAddressesCanonically', () => {
    book.learn('2606:4700:0:0::6810:84E5', 'cf.example', 'capture', 60_000);
    book.learn('::ffff:8.8.8.8', 'dns.google', 'capture', 60_000);

    expect(book.lookup('2606:4700::6810:84e5%en0')?.name).toBe('cf.example');
    expect(book.lookup('8.8.8.8')?.name).toBe('dns.google');
  });

  it('announcesCaptureNames_thatChangeWhatItSays_together', () => {
    book.learnFromCapture([
      { address: '1.1.1.1', name: 'one.one.one.one' },
      { address: '8.8.8.8', name: 'dns.google' },
    ]);
    book.learnFromCapture([{ address: '1.1.1.1', name: 'one.one.one.one' }]);
    book.learn('9.9.9.9', 'dns.quad9.net', 'reverse', 60_000);

    expect(heard).toEqual([
      [
        { address: '1.1.1.1', name: 'one.one.one.one', source: 'capture' },
        { address: '8.8.8.8', name: 'dns.google', source: 'capture' },
      ],
    ]);
  });

  it('forgetsTheOldestAddresses_pastItsCapacity', () => {
    book.learn('1.0.0.1', 'a.example', 'reverse', 60_000);
    book.learn('1.0.0.2', 'b.example', 'reverse', 60_000);
    book.learn('1.0.0.3', 'c.example', 'reverse', 60_000);
    book.learn('1.0.0.1', 'a.example', 'capture', 60_000);

    book.learn('1.0.0.4', 'd.example', 'reverse', 60_000);

    expect(book.lookup('1.0.0.2')).toBeUndefined();
    expect(book.lookup('1.0.0.1')?.name).toBe('a.example');
    expect(book.lookup('1.0.0.4')?.name).toBe('d.example');
  });
});

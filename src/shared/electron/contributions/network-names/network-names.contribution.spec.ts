import { HostName, HostNamesAnswer, NetworkNamesChannel } from '@shared/api/network-names-channels';
import { ContributionContext, ContributionListener, InvokeHandler } from '../main-contribution';
import { HostNameBook } from './host-name-book';
import { NetworkNamesContribution, readAddresses } from './network-names.contribution';

/**
 * A contribution context that records handlers and what was sent.
 */
class FakeContext {
  /**
   * Gets the invoke handlers, by channel.
   */
  public readonly handlers: Map<string, InvokeHandler> = new Map<string, InvokeHandler>();

  /**
   * Gets every message sent, in order.
   */
  public readonly sent: { readonly channel: string; readonly payload: unknown }[] = [];

  /**
   * Gets the logger, which discards.
   */
  public readonly log: ContributionContext['log'] = {
    error: (): void => undefined,
    warn: (): void => undefined,
    info: (): void => undefined,
  };

  /**
   * Records a handler.
   * @param channel The channel.
   * @param handler The handler.
   */
  public handle(channel: string, handler: InvokeHandler): void {
    this.handlers.set(channel, handler);
  }

  /**
   * Gets the listeners, by channel; the contribution registers none.
   */
  public readonly listeners: Map<string, ContributionListener> = new Map<
    string,
    ContributionListener
  >();

  /**
   * Records a listener.
   * @param channel The channel.
   * @param listener The listener.
   */
  public on(channel: string, listener: ContributionListener): void {
    this.listeners.set(channel, listener);
  }

  /**
   * Records a message.
   * @param channel The channel.
   * @param payload The payload.
   */
  public send(channel: string, ...payload: unknown[]): void {
    this.sent.push({ channel, payload: payload[0] });
  }

  /**
   * Asks to name addresses as the renderer would.
   * @param payload The payload.
   * @returns Returns the answer.
   */
  public resolve(payload: unknown): Promise<HostNamesAnswer> {
    return this.handlers.get(NetworkNamesChannel.Resolve)!(
      {} as never,
      payload,
    ) as Promise<HostNamesAnswer>;
  }
}

/**
 * A stand-in for reverse DNS: it answers from a table, rejecting for an address it has no name for,
 * and records what it was asked. Answers may be held back until released.
 */
class FakeReverse {
  /**
   * Gets the names it answers, by address.
   */
  public readonly table: Map<string, readonly string[]> = new Map<string, readonly string[]>();

  /**
   * Gets every address it was asked about, in order.
   */
  public readonly asked: string[] = [];

  /**
   * Gets whether answers are held back until {@link release}.
   */
  public holding: boolean = false;

  /**
   * Gets the most queries it has seen in flight at once.
   */
  public peak: number = 0;

  /**
   * Holds the queries in flight.
   */
  private running: number = 0;

  /**
   * Holds the answers held back.
   */
  private readonly held: (() => void)[] = [];

  /**
   * Answers a reverse query.
   * @param address The address.
   * @returns Returns a promise resolving its names, or rejecting when it has none.
   */
  public async reverse(address: string): Promise<readonly string[]> {
    this.asked.push(address);
    this.running += 1;
    this.peak = Math.max(this.peak, this.running);
    if (this.holding) {
      await new Promise<void>((resolve: () => void): void => void this.held.push(resolve));
    }
    this.running -= 1;
    const names: readonly string[] | undefined = this.table.get(address);
    if (names === undefined) {
      throw new Error('ENOTFOUND');
    }
    return names;
  }

  /**
   * Lets every held answer go.
   */
  public release(): void {
    this.holding = false;
    this.held.splice(0).forEach((resolve: () => void): void => resolve());
  }
}

/**
 * Lets pending promise callbacks run.
 * @returns Returns a promise resolving after them.
 */
function settle(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 0));
}

describe('readAddresses', () => {
  it('takesALimitedListOfIpLiterals_withZones', () => {
    expect(readAddresses(['1.1.1.1', 'fe80::1%en0', '2606:4700::1111'])).toEqual([
      '1.1.1.1',
      'fe80::1%en0',
      '2606:4700::1111',
    ]);
    expect(readAddresses('1.1.1.1')).toBeUndefined();
    expect(readAddresses(['github.com'])).toBeUndefined();
    expect(readAddresses([42])).toBeUndefined();
    expect(readAddresses(new Array<string>(257).fill('1.1.1.1'))).toBeUndefined();
  });
});

describe('NetworkNamesContribution', () => {
  let time: number;
  let context: FakeContext;
  let book: HostNameBook;
  let reverse: FakeReverse;
  let contribution: NetworkNamesContribution;

  beforeEach((): void => {
    time = 1_000_000;
    context = new FakeContext();
    book = new HostNameBook((): number => time);
    reverse = new FakeReverse();
    contribution = new NetworkNamesContribution(
      book,
      (): ((address: string) => Promise<readonly string[]>) =>
        (address: string): Promise<readonly string[]> =>
          reverse.reverse(address),
      (): number => time,
    );
    contribution.activate(context as unknown as ContributionContext);
  });

  afterEach((): void => {
    contribution.dispose();
  });

  it('refusesWhatIsNotAListOfAddresses', async () => {
    expect(await context.resolve(['not an address'])).toEqual({
      kind: 'failed',
      message: 'That is not a list of IP addresses.',
    });
    expect(reverse.asked).toEqual([]);
  });

  it('answersReverseNames_inTheOrderAsked', async () => {
    reverse.table.set('140.82.113.25', ['LB-140-82-113-25-IAD.github.com.']);

    const answer: HostNamesAnswer = await context.resolve(['140.82.113.25', '203.0.113.9']);

    expect(answer).toEqual({
      kind: 'resolved',
      names: [
        { address: '140.82.113.25', name: 'lb-140-82-113-25-iad.github.com', source: 'reverse' },
        { address: '203.0.113.9' },
      ],
    });
  });

  it('prefersACaptureName_withoutAskingReverseDns', async () => {
    book.learnFromCapture([{ address: '140.82.113.25', name: 'api.github.com' }]);

    const answer: HostNamesAnswer = await context.resolve(['140.82.113.25']);

    expect(answer).toEqual({
      kind: 'resolved',
      names: [{ address: '140.82.113.25', name: 'api.github.com', source: 'capture' }],
    });
    expect(reverse.asked).toEqual([]);
  });

  it('answersCaptureNamesForPrivateAddresses_butNeverAsksAboutThem', async () => {
    book.learnFromCapture([{ address: '192.168.1.20', name: 'printer.local' }]);

    const answer: HostNamesAnswer = await context.resolve([
      '192.168.1.20',
      '10.0.0.1',
      '127.0.0.1',
      '169.254.1.1',
      'fe80::1%en0',
      'fd12::1',
      '224.0.0.251',
      'ff02::fb',
      '::1',
    ]);

    expect(
      answer.kind === 'resolved' ? answer.names.map((name: HostName) => name.name) : [],
    ).toEqual([
      'printer.local',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(reverse.asked).toEqual([]);
  });

  it('remembersNames_andTheLackOfThem_forAWhile', async () => {
    reverse.table.set('1.1.1.1', ['one.one.one.one']);
    await context.resolve(['1.1.1.1', '203.0.113.9']);

    await context.resolve(['1.1.1.1', '203.0.113.9']);
    expect(reverse.asked).toEqual(['1.1.1.1', '203.0.113.9']);

    time += 10 * 60 * 1000;
    await context.resolve(['1.1.1.1', '203.0.113.9']);
    expect(reverse.asked).toEqual(['1.1.1.1', '203.0.113.9', '203.0.113.9']);

    time += 60 * 60 * 1000;
    await context.resolve(['1.1.1.1']);
    expect(reverse.asked).toEqual(['1.1.1.1', '203.0.113.9', '203.0.113.9', '1.1.1.1']);
  });

  it('asksOnceForAnAddressAskedAboutTwiceAtOnce', async () => {
    reverse.table.set('2606:4700::1111', ['one.one.one.one']);
    reverse.holding = true;

    const first: Promise<HostNamesAnswer> = context.resolve(['2606:4700:0::1111']);
    const second: Promise<HostNamesAnswer> = context.resolve(['2606:4700::1111']);
    await settle();
    reverse.release();

    expect((await first).kind).toBe('resolved');
    expect(await second).toEqual({
      kind: 'resolved',
      names: [{ address: '2606:4700::1111', name: 'one.one.one.one', source: 'reverse' }],
    });
    expect(reverse.asked).toEqual(['2606:4700::1111']);
  });

  it('asksAtMostEightAtOnce', async () => {
    reverse.holding = true;
    const addresses: readonly string[] = Array.from(
      { length: 20 },
      (_value: unknown, index: number): string => `203.0.113.${String(index + 1)}`,
    );

    const answer: Promise<HostNamesAnswer> = context.resolve(addresses);
    await settle();
    expect(reverse.asked).toHaveLength(8);
    for (let round: number = 0; round < 3; round += 1) {
      reverse.release();
      reverse.holding = true;
      await settle();
    }
    reverse.release();

    expect((await answer).kind).toBe('resolved');
    expect(reverse.asked).toHaveLength(20);
    expect(reverse.peak).toBeLessThanOrEqual(8);
  });

  it('pushesNamesLearnedFromCaptures_inOneBatch', async () => {
    book.learnFromCapture([{ address: '1.1.1.1', name: 'one.one.one.one' }]);
    book.learnFromCapture([{ address: '8.8.8.8', name: 'dns.google' }]);

    await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 300));

    expect(context.sent).toEqual([
      {
        channel: NetworkNamesChannel.Learned,
        payload: [
          { address: '1.1.1.1', name: 'one.one.one.one', source: 'capture' },
          { address: '8.8.8.8', name: 'dns.google', source: 'capture' },
        ],
      },
    ]);
  });
});

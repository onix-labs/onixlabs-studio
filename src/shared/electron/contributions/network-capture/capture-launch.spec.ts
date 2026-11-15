import { CaptureCommand, captureCommand } from './capture-command';
import { elevatedScript, shellQuote } from './capture-launch';

describe('capture launch', () => {
  it('shellQuote_leavesNothingForTheShellToExpand', () => {
    expect(shellQuote('tcp port 443')).toBe(`'tcp port 443'`);
    expect(shellQuote(`it's $(rm -rf ~)`)).toBe(`'it'\\''s $(rm -rf ~)'`);
  });

  it('elevatedScript_runsTcpdumpAsAnAdministrator_droppingToTheUser_andWritingToTheFifo', () => {
    const tcpdump: CaptureCommand | undefined = captureCommand(
      'en0',
      `host "a" and not port 22`,
      'darwin',
      '/t/c/packets',
    );

    expect(elevatedScript(tcpdump!, 'matthew', '/t/c')).toBe(
      `do shell script "echo $$ > '/t/c/pid'; exec '/usr/sbin/tcpdump' '-Z' 'matthew' '-i' 'en0' ` +
        `'-n' '-U' '-s' '0' '-w' '/t/c/packets' '--' 'host \\"a\\" and not port 22' ` +
        `2> '/t/c/errors'" with administrator privileges`,
    );
  });
});

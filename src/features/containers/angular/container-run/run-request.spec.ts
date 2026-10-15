import { describe, expect, it } from 'vitest';
import { readRunForm, RunForm } from './run-request';

/**
 * Builds a form, empty but for what is given.
 * @param fields The fields to set.
 * @returns Returns the form.
 */
function form(fields: Partial<RunForm>): RunForm {
  return { image: 'postgres:16', name: '', ports: '', env: '', volumes: '', ...fields };
}

describe('readRunForm', () => {
  it('readsPortsEnvironmentAndMounts_asADeveloperWritesThem', () => {
    expect(
      readRunForm(
        form({
          name: 'db',
          ports: '5432:5432, 5353:53/udp',
          env: 'POSTGRES_PASSWORD=secret\nEMPTY=\n',
          volumes: 'pgdata:/var/lib/postgresql/data\n/Users/me/conf:/etc/conf:ro',
        }),
      ),
    ).toEqual({
      request: {
        image: 'postgres:16',
        name: 'db',
        ports: [
          { host: 5432, container: 5432, protocol: 'tcp' },
          { host: 5353, container: 53, protocol: 'udp' },
        ],
        env: { POSTGRES_PASSWORD: 'secret', EMPTY: '' },
        volumes: [
          { source: 'pgdata', target: '/var/lib/postgresql/data', readOnly: false },
          { source: '/Users/me/conf', target: '/etc/conf', readOnly: true },
        ],
      },
    });
  });

  it('saysWhatItCannotRead_entryByEntry', () => {
    expect(
      readRunForm(
        form({ image: ' ', name: 'bad name', ports: '80, 99999:1', env: 'nokey', volumes: 'x:y' }),
      ),
    ).toEqual({
      problems: [
        'Name the image to run.',
        `"bad name" is not a container name: use letters, digits, '_', '.' and '-'.`,
        '"80" is not a port mapping: write host:container, as in 8080:80.',
        '"99999:1" is not a port mapping: write host:container, as in 8080:80.',
        '"nokey" is not a variable: write KEY=value.',
        '"x:y" is not a mount: write source:/path, as in data:/var/lib/data.',
      ],
    });
  });

  it('leavesTheNameOutWhenEmpty', () => {
    expect(readRunForm(form({}))).toEqual({
      request: { image: 'postgres:16', ports: [], env: {}, volumes: [] },
    });
  });
});

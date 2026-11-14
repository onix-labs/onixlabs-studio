import {
  GpuEngineKind,
  GpuEngineReading,
  GpuProcessReading,
  GpuReading,
} from '@shared/api/system-monitor-channels';
import {
  ENGINE_LABELS,
  GpuFigures,
  IoregClient,
  IoregStatistics,
  NVIDIA_QUERY_FIELDS,
  parseAmdgpuSysfs,
  parseIoregClients,
  parseIoregStatistics,
  parseNvidiaPmon,
  parseNvidiaQuery,
  parseWindowsGpuCounters,
  WindowsGpuCounter,
} from './gpu-readers';

/**
 * What a {@link GpuSampler} reads the GPU through, so specs can stand in for the machine.
 */
export interface GpuSources {
  /**
   * Gets the platform (`process.platform`).
   */
  readonly platform: string;

  /**
   * Runs a command and resolves with its output, rejecting when it fails or is missing.
   * @param file The command.
   * @param args Its arguments.
   * @returns Returns the output.
   */
  run(file: string, args: readonly string[]): Promise<string>;

  /**
   * Reads a file, rejecting when it cannot.
   * @param path The file.
   * @returns Returns its content.
   */
  readFile(path: string): Promise<string>;

  /**
   * Lists a folder, rejecting when it cannot.
   * @param path The folder.
   * @returns Returns its entries' names.
   */
  readdir(path: string): Promise<readonly string[]>;

  /**
   * Gets the time, in milliseconds.
   * @returns Returns the time.
   */
  now(): number;
}

/**
 * The PowerShell that reads Windows' GPU counters as JSON.
 */
const WINDOWS_COUNTERS_COMMAND: string = [
  "$c = Get-Counter -Counter '\\GPU Engine(*)\\Utilization Percentage','\\GPU Process Memory(*)\\Dedicated Usage','\\GPU Adapter Memory(*)\\Dedicated Usage' -ErrorAction SilentlyContinue",
  '$c.CounterSamples | Select-Object Path,InstanceName,CookedValue | ConvertTo-Json -Compress',
].join('; ');

/**
 * The `amdgpu` sysfs files read, relative to a card's `device` folder (`hwmon/` standing for its
 * hwmon folder).
 */
const AMDGPU_FILES: readonly string[] = [
  'gpu_busy_percent',
  'mem_info_vram_used',
  'mem_info_vram_total',
  'pp_dpm_sclk',
  'pp_dpm_mclk',
  'hwmon/temp1_input',
  'hwmon/power1_average',
  'hwmon/power1_input',
  'hwmon/power1_cap',
  'hwmon/fan1_input',
];

/**
 * Reads the GPU, the way the platform offers: macOS's accelerator statistics and clients (`ioreg`);
 * `nvidia-smi` on Windows and Linux where an NVIDIA GPU answers; Windows' GPU counters (any vendor);
 * Linux's `amdgpu` sysfs. A reading with processes also reads what is costlier: the engines and each
 * process's use.
 *
 * Stateful: macOS reports engines as commands submitted and processes as GPU time used, both running
 * totals, so their rates come from the change since the last reading. A sampler's first reading has
 * no rates yet. Use one sampler per stream of readings, so their rates do not interleave.
 */
export class GpuSampler {
  /**
   * Holds each engine kind's commands submitted at the last reading, and when.
   */
  private previousCommands: {
    readonly at: number;
    readonly totals: ReadonlyMap<GpuEngineKind, number>;
  } | null = null;

  /**
   * Holds each process's GPU time at the last reading, and when.
   */
  private previousClients: {
    readonly at: number;
    readonly clients: ReadonlyMap<number, IoregClient>;
  } | null = null;

  /**
   * Holds whether `nvidia-smi` failed, so it is not asked again on a machine without one.
   */
  private nvidiaMissing: boolean = false;

  /**
   * Holds whether the last reading needed Windows' counters, a PowerShell query of a second or more.
   */
  private usedCounters: boolean = false;

  /**
   * Creates a sampler.
   * @param sources What it reads the GPU through.
   * @param detailed Whether its readings carry engines and processes, or the GPU's figures alone.
   */
  public constructor(
    private readonly sources: GpuSources,
    private readonly detailed: boolean,
  ) {}

  /**
   * Gets whether the last reading was costly (Windows' counters), so a background reader can slow down.
   */
  public get costly(): boolean {
    return this.usedCounters;
  }

  /**
   * Reads the GPU.
   * @returns Returns the reading, or undefined where no source reports the GPU.
   */
  public async read(): Promise<GpuReading | undefined> {
    switch (this.sources.platform) {
      case 'darwin':
        return this.readDarwin();
      case 'win32':
        return this.readWindows();
      case 'linux':
        return this.readLinux();
      default:
        return undefined;
    }
  }

  /**
   * Reads the GPU on macOS from its accelerator statistics, and its clients for a detailed reading.
   * @returns Returns the reading, or undefined without an accelerator.
   */
  private async readDarwin(): Promise<GpuReading | undefined> {
    const [statsOutput, clientsOutput]: [string, string | undefined] = await Promise.all([
      this.sources.run('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator']),
      this.detailed
        ? this.sources.run('ioreg', ['-r', '-l', '-w', '0', '-d', '6', '-c', 'IOAccelerator'])
        : Promise.resolve(undefined),
    ]);
    const statistics: IoregStatistics | undefined = parseIoregStatistics(statsOutput);
    if (statistics === undefined) {
      return undefined;
    }
    const now: number = this.sources.now();
    return this.reading(
      statistics.figures,
      this.detailed ? [...statistics.engines, ...this.commandRates(statistics.commands, now)] : [],
      clientsOutput === undefined ? [] : this.clientShares(parseIoregClients(clientsOutput), now),
    );
  }

  /**
   * Reads the GPU on Windows: `nvidia-smi` for an NVIDIA GPU's figures, and the GPU counters (any
   * vendor) for the engines and processes, or for the utilisation where `nvidia-smi` is not there.
   * @returns Returns the reading, or undefined where neither reports the GPU.
   */
  private async readWindows(): Promise<GpuReading | undefined> {
    const nvidia: { figures: GpuFigures; processes: readonly GpuProcessReading[] } | undefined =
      await this.readNvidia();
    this.usedCounters = this.detailed || nvidia === undefined;
    if (!this.usedCounters) {
      return nvidia === undefined ? undefined : this.reading(nvidia.figures, [], []);
    }
    let samples: readonly WindowsGpuCounter[] = [];
    try {
      const parsed: unknown = JSON.parse(
        await this.sources.run('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          WINDOWS_COUNTERS_COMMAND,
        ]),
      );
      samples = Array.isArray(parsed)
        ? (parsed as WindowsGpuCounter[])
        : [parsed as WindowsGpuCounter];
    } catch {
      // The counters are unavailable (an old Windows, or no GPU driver that publishes them).
    }
    if (samples.length === 0 && nvidia === undefined) {
      return undefined;
    }
    const counters: ReturnType<typeof parseWindowsGpuCounters> = parseWindowsGpuCounters(samples);
    return this.reading(
      { ...counters.figures, ...nvidia?.figures },
      counters.engines,
      mergeProcesses(counters.processes, nvidia?.processes ?? []),
    );
  }

  /**
   * Reads the GPU on Linux: an AMD card's `amdgpu` sysfs, or `nvidia-smi` for an NVIDIA GPU.
   * @returns Returns the reading, or undefined where neither reports the GPU.
   */
  private async readLinux(): Promise<GpuReading | undefined> {
    const amd: GpuFigures | undefined = await this.readAmdgpu();
    if (amd !== undefined) {
      return this.reading(amd, [], []);
    }
    const nvidia: { figures: GpuFigures; processes: readonly GpuProcessReading[] } | undefined =
      await this.readNvidia();
    if (nvidia === undefined) {
      return undefined;
    }
    return this.reading(
      nvidia.figures,
      nvidiaEngines(nvidia.figures, nvidia.processes),
      nvidia.processes,
    );
  }

  /**
   * Reads an NVIDIA GPU through `nvidia-smi`: its figures, and for a detailed reading each process's
   * use. Once it fails it is not asked again.
   * @returns Returns the figures and processes, or undefined without `nvidia-smi`.
   */
  private async readNvidia(): Promise<
    { figures: GpuFigures; processes: readonly GpuProcessReading[] } | undefined
  > {
    if (this.nvidiaMissing) {
      return undefined;
    }
    try {
      const [query, pmon]: [string, string] = await Promise.all([
        this.sources.run('nvidia-smi', [
          `--query-gpu=${NVIDIA_QUERY_FIELDS.join(',')}`,
          '--format=csv,noheader,nounits',
        ]),
        this.detailed
          ? this.sources.run('nvidia-smi', ['pmon', '-c', '1', '-s', 'um']).catch((): string => '')
          : Promise.resolve(''),
      ]);
      return { figures: parseNvidiaQuery(query), processes: parseNvidiaPmon(pmon) };
    } catch {
      this.nvidiaMissing = true;
      return undefined;
    }
  }

  /**
   * Reads the first AMD card's `amdgpu` sysfs figures.
   * @returns Returns the figures, or undefined without an AMD card.
   */
  private async readAmdgpu(): Promise<GpuFigures | undefined> {
    let cards: readonly string[];
    try {
      cards = (await this.sources.readdir('/sys/class/drm')).filter((name: string): boolean =>
        /^card\d+$/.test(name),
      );
    } catch {
      return undefined;
    }
    for (const card of cards) {
      const device: string = `/sys/class/drm/${card}/device`;
      const vendor: string = await this.sources
        .readFile(`${device}/vendor`)
        .catch((): string => '');
      if (vendor.trim() !== '0x1002') {
        continue;
      }
      const hwmon: string | undefined = (
        await this.sources.readdir(`${device}/hwmon`).catch((): readonly string[] => [])
      )[0];
      const files: Map<string, string> = new Map<string, string>();
      await Promise.all(
        AMDGPU_FILES.map(async (name: string): Promise<void> => {
          const path: string = name.startsWith('hwmon/')
            ? `${device}/hwmon/${hwmon ?? 'none'}/${name.slice('hwmon/'.length)}`
            : `${device}/${name}`;
          const content: string | undefined = await this.sources
            .readFile(path)
            .catch((): undefined => undefined);
          if (content !== undefined) {
            files.set(name, content);
          }
        }),
      );
      return parseAmdgpuSysfs(files);
    }
    return undefined;
  }

  /**
   * Works out each engine kind's commands a second since the last reading.
   * @param totals Each kind's commands submitted so far.
   * @param now The time, in milliseconds.
   * @returns Returns each kind's rate, none on the first reading.
   */
  private commandRates(
    totals: ReadonlyMap<GpuEngineKind, number>,
    now: number,
  ): readonly GpuEngineReading[] {
    const previous: typeof this.previousCommands = this.previousCommands;
    this.previousCommands = { at: now, totals };
    if (previous === null || now <= previous.at) {
      return [];
    }
    const seconds: number = (now - previous.at) / 1000;
    return (Object.keys(ENGINE_LABELS) as GpuEngineKind[])
      .filter((kind: GpuEngineKind): boolean => totals.has(kind))
      .map((kind: GpuEngineKind): GpuEngineReading => ({
        kind,
        label: ENGINE_LABELS[kind],
        value: Math.max(0, ((totals.get(kind) ?? 0) - (previous.totals.get(kind) ?? 0)) / seconds),
        unit: 'commands',
      }));
  }

  /**
   * Works out each process's share of the GPU since the last reading: the GPU time its clients used,
   * of the time that passed.
   * @param clients Each process's GPU time so far.
   * @param now The time, in milliseconds.
   * @returns Returns each process that used the GPU, busiest first; none on the first reading.
   */
  private clientShares(
    clients: ReadonlyMap<number, IoregClient>,
    now: number,
  ): readonly GpuProcessReading[] {
    const previous: typeof this.previousClients = this.previousClients;
    this.previousClients = { at: now, clients };
    if (previous === null || now <= previous.at) {
      return [];
    }
    const elapsedNs: number = (now - previous.at) * 1e6;
    const shares: GpuProcessReading[] = [];
    for (const [pid, client] of clients) {
      const before: number = previous.clients.get(pid)?.gpuTimeNs ?? client.gpuTimeNs;
      const used: number = client.gpuTimeNs - before;
      if (used > 0) {
        shares.push({
          pid,
          name: client.name,
          gpuPercent: Math.min(100, (used / elapsedNs) * 100),
        });
      }
    }
    return shares;
  }

  /**
   * Assembles a reading, its processes busiest first.
   * @param figures The GPU's figures.
   * @param engines Its engines.
   * @param processes Its processes.
   * @returns Returns the reading.
   */
  private reading(
    figures: GpuFigures,
    engines: readonly GpuEngineReading[],
    processes: readonly GpuProcessReading[],
  ): GpuReading {
    return {
      timestamp: new Date(this.sources.now()).toISOString(),
      ...figures,
      engines,
      processes: [...processes].sort(
        (a: GpuProcessReading, b: GpuProcessReading): number =>
          (b.gpuPercent ?? 0) - (a.gpuPercent ?? 0) || (b.memoryBytes ?? 0) - (a.memoryBytes ?? 0),
      ),
    };
  }
}

/**
 * Works out an NVIDIA GPU's engines on Linux, where no counters break it down: its utilisation as the
 * 3D engine, and the processes' encoder and decoder shares summed.
 * @param figures The GPU's figures.
 * @param processes Each process's use.
 * @returns Returns the engines.
 */
function nvidiaEngines(
  figures: GpuFigures,
  processes: readonly GpuProcessReading[],
): readonly GpuEngineReading[] {
  if (processes.length === 0 && figures.utilisationPercent === undefined) {
    return [];
  }
  const sum: (pick: (process: GpuProcessReading) => number | undefined) => number = (
    pick: (process: GpuProcessReading) => number | undefined,
  ): number =>
    Math.min(
      100,
      processes.reduce(
        (total: number, process: GpuProcessReading): number => total + (pick(process) ?? 0),
        0,
      ),
    );
  return [
    {
      kind: '3d',
      label: ENGINE_LABELS['3d'],
      value: figures.utilisationPercent ?? 0,
      unit: 'percent',
    },
    {
      kind: 'decode',
      label: ENGINE_LABELS.decode,
      value: sum((process: GpuProcessReading): number | undefined => process.decoderPercent),
      unit: 'percent',
    },
    {
      kind: 'encode',
      label: ENGINE_LABELS.encode,
      value: sum((process: GpuProcessReading): number | undefined => process.encoderPercent),
      unit: 'percent',
    },
  ];
}

/**
 * Merges Windows' per-process counters with `nvidia-smi`'s, which add the encoder and decoder.
 * @param counters The counters' processes.
 * @param nvidia `nvidia-smi`'s processes.
 * @returns Returns each process once.
 */
function mergeProcesses(
  counters: readonly GpuProcessReading[],
  nvidia: readonly GpuProcessReading[],
): readonly GpuProcessReading[] {
  const byPid: Map<number, GpuProcessReading> = new Map<number, GpuProcessReading>(
    counters.map((process: GpuProcessReading): [number, GpuProcessReading] => [
      process.pid,
      process,
    ]),
  );
  for (const process of nvidia) {
    byPid.set(process.pid, { ...process, ...byPid.get(process.pid) });
  }
  return [...byPid.values()];
}

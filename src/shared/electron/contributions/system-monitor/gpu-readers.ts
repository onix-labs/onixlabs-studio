import {
  GpuEngineKind,
  GpuEngineReading,
  GpuProcessReading,
  GpuReading,
} from '@shared/api/system-monitor-channels';

/**
 * A GPU reading without its timestamp, engines or processes: the figures one source reports.
 */
export type GpuFigures = Partial<Omit<GpuReading, 'timestamp' | 'engines' | 'processes'>>;

/**
 * What macOS's accelerator statistics give: the GPU's figures, each engine's commands submitted so far
 * (AMD), and each engine's busy share (Apple silicon).
 */
export interface IoregStatistics {
  /**
   * Gets the GPU's figures.
   */
  readonly figures: GpuFigures;

  /**
   * Gets the commands each engine kind has had submitted since boot (AMD's hardware channels).
   */
  readonly commands: ReadonlyMap<GpuEngineKind, number>;

  /**
   * Gets each engine's busy share where the driver reports one (Apple silicon's renderer and tiler).
   */
  readonly engines: readonly GpuEngineReading[];

  /**
   * Gets the accelerator's driver class (`AMDRadeonX6000_AMDNavi21GraphicsAccelerator`).
   */
  readonly driverClass: string;
}

/**
 * One process's use of the GPU on macOS: its name and the GPU time its clients have used.
 */
export interface IoregClient {
  /**
   * Gets the process's name.
   */
  readonly name: string;

  /**
   * Gets the GPU time its clients have used since they opened, in nanoseconds.
   */
  readonly gpuTimeNs: number;
}

/**
 * One counter sample of Windows' GPU counters, as `ConvertTo-Json` writes it.
 */
export interface WindowsGpuCounter {
  readonly Path?: string;
  readonly InstanceName?: string;
  readonly CookedValue?: number;
}

/**
 * How each engine kind is named, in the order the view lists them.
 */
export const ENGINE_LABELS: Readonly<Record<GpuEngineKind, string>> = {
  '3d': '3D / Graphics',
  decode: 'Video Decode',
  encode: 'Video Encode',
  copy: 'Copy',
  compute: 'Compute',
  other: 'Other',
};

/**
 * The architectures GPU driver class and model names reveal.
 */
const ARCHITECTURES: readonly (readonly [RegExp, string])[] = [
  [/Navi3\d/i, 'RDNA 3'],
  [/Navi2\d/i, 'RDNA 2'],
  [/Navi1\d/i, 'RDNA'],
  [/Vega/i, 'GCN 5 (Vega)'],
  [/Polaris|Baffin|Ellesmere/i, 'GCN 4 (Polaris)'],
  [/RTX 50\d\d/i, 'Blackwell'],
  [/RTX 40\d\d|RTX \d000 Ada|L40/i, 'Ada Lovelace'],
  [/RTX 30\d\d|A\d000\b/i, 'Ampere'],
  [/RTX 20\d\d|GTX 16\d\d|Quadro RTX/i, 'Turing'],
  [/AGXG13|Apple M1/i, 'Apple G13 (M1)'],
  [/AGXG14|Apple M2/i, 'Apple G14 (M2)'],
  [/AGXG15|Apple M3/i, 'Apple G15 (M3)'],
  [/AGXG16|Apple M4/i, 'Apple G16 (M4)'],
];

/**
 * Names a GPU's architecture from its driver class or model, where either reveals it.
 * @param names The driver class and model names to look in.
 * @returns Returns the architecture, or undefined when none reveals it.
 */
export function architectureOf(...names: readonly string[]): string | undefined {
  for (const [pattern, architecture] of ARCHITECTURES) {
    if (names.some((name: string): boolean => pattern.test(name))) {
      return architecture;
    }
  }
  return undefined;
}

/**
 * Works out what an AMD hardware channel does from its name (`GFX`, `VCN0Dec`, `SDMA1_PAGE`).
 * @param channel The channel's name.
 * @returns Returns the engine kind, or undefined for the kernel's own queues.
 */
export function engineKindOfChannel(channel: string): GpuEngineKind | undefined {
  if (/^GFX/i.test(channel)) {
    return '3d';
  }
  if (/^VCN\d*Dec/i.test(channel) || /^UVD/i.test(channel)) {
    return 'decode';
  }
  if (/^VCN\d*Enc/i.test(channel) || /^VCE/i.test(channel)) {
    return 'encode';
  }
  if (/^SDMA/i.test(channel)) {
    return 'copy';
  }
  if (/^(COMP|MEC)/i.test(channel)) {
    return 'compute';
  }
  return undefined;
}

/**
 * Keeps a reading only when it is a finite, non-negative number.
 * @param value The reading.
 * @returns Returns the reading, or undefined.
 */
function counted(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Drops the figures that are undefined.
 * @param figures The figures.
 * @returns Returns the defined figures.
 */
function defined(figures: Record<string, number | undefined>): GpuFigures {
  return Object.fromEntries(
    Object.entries(figures).filter(
      ([, value]: [string, number | undefined]): boolean => value !== undefined,
    ),
  );
}

/**
 * Splits `ioreg` output into its top-level accelerators, each once: macOS lists an accelerator once for
 * each class it matches, the copies identical, so a later copy of an id already seen is dropped.
 * @param output The output of `ioreg -r -c IOAccelerator`.
 * @returns Returns each accelerator's lines.
 */
function accelerators(output: string): readonly (readonly string[])[] {
  const sections: string[][] = [];
  const seen: Set<string> = new Set<string>();
  let current: string[] | null = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('+-o ')) {
      const id: string = /\bid (0x[0-9a-f]+)/i.exec(line)?.[1] ?? line;
      current = seen.has(id) ? null : [];
      seen.add(id);
      if (current !== null) {
        sections.push(current);
      }
    }
    current?.push(line);
  }
  return sections;
}

/**
 * Parses macOS's accelerator statistics (`ioreg -r -d 1 -w 0 -c IOAccelerator`) for the first GPU: its
 * utilisation, video memory, temperature, power, fan and clocks where the driver reports them, the
 * commands each AMD engine has had submitted, and Apple silicon's renderer and tiler shares.
 * @param output The command's output.
 * @returns Returns the statistics, or undefined when there is no accelerator.
 */
export function parseIoregStatistics(output: string): IoregStatistics | undefined {
  const section: readonly string[] | undefined = accelerators(output)[0];
  if (section === undefined) {
    return undefined;
  }
  const text: string = section.join('\n');
  const statistics: string = /"PerformanceStatistics" = \{([^}]*)\}/.exec(text)?.[1] ?? '';
  const fields: Map<string, number> = new Map<string, number>();
  for (const match of statistics.matchAll(/"([^"]+)"=(-?\d+)/g)) {
    fields.set(match[1], Number(match[2]));
  }
  const commands: Map<GpuEngineKind, number> = new Map<GpuEngineKind, number>();
  for (const [name, value] of fields) {
    const channel: string | undefined = /^HWChannel (\S+) \| Commands Submitted$/.exec(name)?.[1];
    const kind: GpuEngineKind | undefined =
      channel === undefined ? undefined : engineKindOfChannel(channel);
    if (kind !== undefined) {
      commands.set(kind, (commands.get(kind) ?? 0) + value);
    }
  }
  const engines: GpuEngineReading[] = [];
  const renderer: number | undefined = fields.get('Renderer Utilization %');
  if (renderer !== undefined) {
    engines.push({ kind: '3d', label: 'Renderer', value: renderer, unit: 'percent' });
  }
  const tiler: number | undefined = fields.get('Tiler Utilization %');
  if (tiler !== undefined) {
    engines.push({ kind: 'other', label: 'Tiler', value: tiler, unit: 'percent' });
  }
  const utilisation: number | undefined =
    fields.get('Device Utilization %') ?? fields.get('GPU Activity(%)');
  return {
    figures: defined({
      utilisationPercent:
        utilisation === undefined ? undefined : Math.min(100, Math.max(0, utilisation)),
      memoryUsedBytes: counted(
        fields.get('inUseVidMemoryBytes') ?? fields.get('In use system memory'),
      ),
      temperatureC: counted(fields.get('Temperature(C)')),
      powerWatts: counted(fields.get('Total Power(W)')),
      fanRpm: counted(fields.get('Fan Speed(RPM)')),
      fanPercent: counted(fields.get('Fan Speed(%)')),
      coreClockMhz: counted(fields.get('Core Clock(MHz)')),
      memoryClockMhz: counted(fields.get('Memory Clock(MHz)')),
    }),
    commands,
    engines,
    driverClass: /<class ([^,>]+)/.exec(section[0])?.[1] ?? '',
  };
}

/**
 * Parses macOS's accelerator clients (`ioreg -r -l -w 0 -d 6 -c IOAccelerator`): each process's GPU
 * time, summed across its clients, for the first GPU.
 * @param output The command's output.
 * @returns Returns each process's GPU time and name, by pid.
 */
export function parseIoregClients(output: string): ReadonlyMap<number, IoregClient> {
  const clients: Map<number, IoregClient> = new Map<number, IoregClient>();
  const section: readonly string[] = accelerators(output)[0] ?? [];
  let pid: number | undefined;
  let name: string = '';
  let time: number | undefined;
  const flush: () => void = (): void => {
    if (pid !== undefined && time !== undefined) {
      const known: IoregClient | undefined = clients.get(pid);
      clients.set(pid, { name: known?.name ?? name, gpuTimeNs: (known?.gpuTimeNs ?? 0) + time });
    }
    pid = undefined;
    name = '';
    time = undefined;
  };
  for (const line of section) {
    if (/^\s*\|?\s*\+-o /.test(line)) {
      flush();
      continue;
    }
    const creator: RegExpExecArray | null = /"IOUserClientCreator" = "pid (\d+), (.*)"/.exec(line);
    if (creator !== null) {
      pid = Number(creator[1]);
      name = creator[2];
    }
    const gpuTime: RegExpExecArray | null = /"accumulatedGPUTime" = (\d+)/.exec(line);
    if (gpuTime !== null) {
      time = Number(gpuTime[1]);
    }
  }
  flush();
  return clients;
}

/**
 * Parses an `nvidia-smi` CSV value (`[N/A]`, `[Not Supported]` and the like read as nothing).
 * @param value The value.
 * @returns Returns the number, or undefined.
 */
function nvidiaNumber(value: string | undefined): number | undefined {
  const parsed: number = Number((value ?? '').trim());
  return (value ?? '').trim().length > 0 && Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * The fields the monitor asks `nvidia-smi --query-gpu` for, in order.
 */
export const NVIDIA_QUERY_FIELDS: readonly string[] = [
  'utilization.gpu',
  'memory.used',
  'memory.total',
  'memory.reserved',
  'temperature.gpu',
  'power.draw',
  'power.limit',
  'fan.speed',
  'clocks.gr',
  'clocks.mem',
];

/**
 * Parses `nvidia-smi --query-gpu=<NVIDIA_QUERY_FIELDS> --format=csv,noheader,nounits` for the first GPU.
 * Memory is in MiB.
 * @param csv The command's output.
 * @returns Returns the GPU's figures.
 */
export function parseNvidiaQuery(csv: string): GpuFigures {
  const values: string[] = (csv.split('\n')[0] ?? '').split(',');
  const at: (field: string) => number | undefined = (field: string): number | undefined =>
    nvidiaNumber(values[NVIDIA_QUERY_FIELDS.indexOf(field)]);
  const mib: (field: string) => number | undefined = (field: string): number | undefined => {
    const value: number | undefined = at(field);
    return value === undefined ? undefined : value * 1024 * 1024;
  };
  return defined({
    utilisationPercent: at('utilization.gpu'),
    memoryUsedBytes: mib('memory.used'),
    memoryTotalBytes: mib('memory.total'),
    memoryReservedBytes: mib('memory.reserved'),
    temperatureC: at('temperature.gpu'),
    powerWatts: at('power.draw'),
    powerLimitWatts: at('power.limit'),
    fanPercent: at('fan.speed'),
    coreClockMhz: at('clocks.gr'),
    memoryClockMhz: at('clocks.mem'),
  });
}

/**
 * Parses `nvidia-smi pmon -c 1 -s um`: each process's share of the streaming multiprocessors, the
 * encoder and the decoder, and its frame-buffer memory (MiB). Its columns vary by driver, so they are
 * read by the header line's names; `-` reads as nothing.
 * @param text The command's output.
 * @returns Returns each process's use, by pid.
 */
export function parseNvidiaPmon(text: string): readonly GpuProcessReading[] {
  const lines: string[] = text.split('\n');
  const header: string[] = (lines.find((line: string): boolean => /^#\s*gpu/.test(line)) ?? '')
    .replace(/^#\s*/, '')
    .split(/\s+/);
  const column: (fields: string[], name: string) => number | undefined = (
    fields: string[],
    name: string,
  ): number | undefined => {
    const index: number = header.indexOf(name);
    return index < 0 ? undefined : nvidiaNumber(fields[index]);
  };
  const byPid: Map<number, GpuProcessReading> = new Map<number, GpuProcessReading>();
  for (const line of lines) {
    if (line.startsWith('#') || line.trim().length === 0) {
      continue;
    }
    const fields: string[] = line.trim().split(/\s+/);
    const pid: number | undefined = column(fields, 'pid');
    if (pid === undefined) {
      continue;
    }
    const fb: number | undefined = column(fields, 'fb');
    const commandIndex: number = header.indexOf('command');
    byPid.set(pid, {
      pid,
      ...(commandIndex >= 0 && fields[commandIndex] !== undefined
        ? { name: fields[commandIndex] }
        : {}),
      ...defined({
        gpuPercent: column(fields, 'sm'),
        encoderPercent: column(fields, 'enc'),
        decoderPercent: column(fields, 'dec'),
        memoryBytes: fb === undefined ? undefined : fb * 1024 * 1024,
      }),
    });
  }
  return [...byPid.values()];
}

/**
 * The engine kinds Windows names in its GPU Engine counters' instances (`engtype_3D`).
 */
const WINDOWS_ENGINES: Readonly<Record<string, GpuEngineKind>> = {
  '3d': '3d',
  graphics_1: '3d',
  videodecode: 'decode',
  videoencode: 'encode',
  copy: 'copy',
  compute: 'compute',
  compute_0: 'compute',
  compute_1: 'compute',
};

/**
 * Parses Windows' GPU counters (`\\GPU Engine(*)\\Utilization Percentage`, `\\GPU Process Memory(*)\\
 * Dedicated Usage` and `\\GPU Adapter Memory(*)\\Dedicated Usage`), as Task Manager reads them: an
 * engine kind's utilisation is its busiest engine's (each engine's being the sum over the processes on
 * it), the GPU's is its busiest kind's, and a process's is its busiest engine's.
 * @param samples The counter samples.
 * @returns Returns the GPU's figures, engines and processes.
 */
export function parseWindowsGpuCounters(samples: readonly WindowsGpuCounter[]): {
  readonly figures: GpuFigures;
  readonly engines: readonly GpuEngineReading[];
  readonly processes: readonly GpuProcessReading[];
} {
  const engineLoad: Map<string, { kind: GpuEngineKind; value: number }> = new Map<
    string,
    { kind: GpuEngineKind; value: number }
  >();
  const processLoad: Map<number, number> = new Map<number, number>();
  const processMemory: Map<number, number> = new Map<number, number>();
  let adapterMemory: number | undefined;
  for (const sample of samples) {
    const path: string = (sample.Path ?? '').toLowerCase();
    const instance: string = (sample.InstanceName ?? '').toLowerCase();
    const value: number = Number.isFinite(sample.CookedValue) ? (sample.CookedValue ?? 0) : 0;
    const pid: number | undefined = Number(/pid_(\d+)/.exec(instance)?.[1] ?? Number.NaN);
    if (path.includes('\\gpu engine(') && path.endsWith('\\utilization percentage')) {
      const type: string = /engtype_([a-z0-9_]+)/.exec(instance)?.[1] ?? '';
      const engine: string = /luid_[^_]+_[^_]+_phys_\d+_eng_\d+/.exec(instance)?.[0] ?? instance;
      const kind: GpuEngineKind = WINDOWS_ENGINES[type] ?? 'other';
      const current: { kind: GpuEngineKind; value: number } | undefined = engineLoad.get(engine);
      engineLoad.set(engine, { kind, value: (current?.value ?? 0) + value });
      if (Number.isFinite(pid)) {
        processLoad.set(pid, Math.max(processLoad.get(pid) ?? 0, value));
      }
    } else if (path.includes('\\gpu process memory(') && path.endsWith('\\dedicated usage')) {
      if (Number.isFinite(pid)) {
        processMemory.set(pid, (processMemory.get(pid) ?? 0) + value);
      }
    } else if (path.includes('\\gpu adapter memory(') && path.endsWith('\\dedicated usage')) {
      adapterMemory = Math.max(adapterMemory ?? 0, value);
    }
  }
  const byKind: Map<GpuEngineKind, number> = new Map<GpuEngineKind, number>();
  for (const { kind, value } of engineLoad.values()) {
    byKind.set(kind, Math.max(byKind.get(kind) ?? 0, Math.min(100, value)));
  }
  const engines: GpuEngineReading[] = (Object.keys(ENGINE_LABELS) as GpuEngineKind[])
    .filter((kind: GpuEngineKind): boolean => byKind.has(kind) && kind !== 'other')
    .map((kind: GpuEngineKind): GpuEngineReading => ({
      kind,
      label: ENGINE_LABELS[kind],
      value: byKind.get(kind) ?? 0,
      unit: 'percent',
    }));
  const pids: Set<number> = new Set<number>([...processLoad.keys(), ...processMemory.keys()]);
  const processes: readonly GpuProcessReading[] = [...pids].map(
    (pid: number): GpuProcessReading => ({
      pid,
      ...defined({
        gpuPercent: processLoad.has(pid) ? Math.min(100, processLoad.get(pid) ?? 0) : undefined,
        memoryBytes: processMemory.get(pid),
      }),
    }),
  );
  return {
    figures: defined({
      utilisationPercent: byKind.size === 0 ? undefined : Math.max(...byKind.values()),
      memoryUsedBytes: adapterMemory,
    }),
    engines,
    processes,
  };
}

/**
 * Parses a Linux `amdgpu` clock table (`pp_dpm_sclk`): the level marked current.
 * @param table The table (`0: 500Mhz\n1: 2100Mhz *`).
 * @returns Returns the current clock in MHz, or undefined.
 */
export function parseDpmClock(table: string): number | undefined {
  const current: string | undefined = table
    .split('\n')
    .find((line: string): boolean => line.trim().endsWith('*'));
  const mhz: number = Number(/(\d+)\s*Mhz/i.exec(current ?? '')?.[1] ?? Number.NaN);
  return Number.isFinite(mhz) ? mhz : undefined;
}

/**
 * Reads a Linux `amdgpu` card's sysfs figures: its busy share, video memory, and (from its hwmon) its
 * temperature in millidegrees, power in microwatts and fan in RPM.
 * @param files Each file's content, by its path relative to the card's `device` folder; a file not read
 * is absent.
 * @returns Returns the GPU's figures.
 */
export function parseAmdgpuSysfs(files: ReadonlyMap<string, string>): GpuFigures {
  const number: (name: string) => number | undefined = (name: string): number | undefined => {
    const text: string | undefined = files.get(name);
    return text === undefined ? undefined : counted(Number(text.trim()));
  };
  const temperature: number | undefined = number('hwmon/temp1_input');
  const power: number | undefined = number('hwmon/power1_average') ?? number('hwmon/power1_input');
  const cap: number | undefined = number('hwmon/power1_cap');
  return defined({
    utilisationPercent: number('gpu_busy_percent'),
    memoryUsedBytes: number('mem_info_vram_used'),
    memoryTotalBytes: number('mem_info_vram_total'),
    temperatureC: temperature === undefined ? undefined : temperature / 1000,
    powerWatts: power === undefined ? undefined : power / 1e6,
    powerLimitWatts: cap === undefined ? undefined : cap / 1e6,
    fanRpm: number('hwmon/fan1_input'),
    coreClockMhz: parseDpmClock(files.get('pp_dpm_sclk') ?? ''),
    memoryClockMhz: parseDpmClock(files.get('pp_dpm_mclk') ?? ''),
  });
}

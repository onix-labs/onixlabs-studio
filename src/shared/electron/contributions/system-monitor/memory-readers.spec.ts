import { describe, expect, it } from 'vitest';
import {
  darwinMemory,
  darwinMemoryModules,
  layoutMemoryModules,
  linuxMemory,
  MemoryBreakdown,
  MemoryModules,
  windowsMemory,
} from './memory-readers';

/**
 * `vm_stat` as this Mac printed it, trimmed.
 */
const VM_STAT: string = `Mach Virtual Memory Statistics: (page size of 4096 bytes)
Pages free:                                 50273834.
Pages active:                                7207389.
Pages wired down:                            2421616.
Pages purgeable:                               64336.
"Translation faults":                     1792977647.
File-backed pages:                           5589578.
Anonymous pages:                             8820832.
Pages occupied by compressor:                   1000.
Pageins:                                    10243683.
Pageouts:                                          7.
`;

describe('darwinMemory', () => {
  it('breaksMemoryDown_asActivityMonitorDoes', () => {
    const memory: MemoryBreakdown = darwinMemory(VM_STAT, '1\n96\n');

    expect(memory.appBytes).toBe((8820832 - 64336) * 4096);
    expect(memory.wiredBytes).toBe(2421616 * 4096);
    expect(memory.compressedBytes).toBe(1000 * 4096);
    expect(memory.cachedBytes).toBe((5589578 + 64336) * 4096);
    expect(memory.freeBytes).toBe(50273834 * 4096);
    expect([memory.pageIns, memory.pageOuts]).toEqual([10243683, 7]);
    expect(memory.pressure).toEqual({ level: 'normal', percent: 4 });
  });

  it('readsTheKernelsWarningAndCriticalLevels', () => {
    expect(darwinMemory(VM_STAT, '2 40').pressure?.level).toBe('warning');
    expect(darwinMemory(VM_STAT, '4 5').pressure?.level).toBe('critical');
  });

  it('leavesOutPressure_whenTheKernelDoesNotSay', () => {
    expect(darwinMemory(VM_STAT, '').pressure).toBeUndefined();
  });
});

describe('linuxMemory', () => {
  const meminfo: string = [
    'MemTotal:       16000000 kB',
    'MemFree:         2000000 kB',
    'MemAvailable:    9000000 kB',
    'Buffers:          100000 kB',
    'Cached:          5000000 kB',
    'SReclaimable:     400000 kB',
    'AnonPages:       6000000 kB',
    'Unevictable:       50000 kB',
  ].join('\n');

  it('breaksMemoryDown_fromProc', () => {
    const memory: MemoryBreakdown = linuxMemory(
      meminfo,
      'pswpin 12\npswpout 34\n',
      'some avg10=7.50 avg60=1.00 avg300=0.10 total=1\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0',
    );

    expect(memory.appBytes).toBe(6000000 * 1024);
    expect(memory.wiredBytes).toBe(50000 * 1024);
    expect(memory.cachedBytes).toBe((5000000 + 100000 + 400000) * 1024);
    expect(memory.compressedBytes).toBeUndefined();
    expect([memory.pageIns, memory.pageOuts]).toEqual([12, 34]);
    expect(memory.pressure).toEqual({ level: 'warning', percent: 7.5 });
  });

  it('leavesOutPressure_whereTheKernelHasNoStallInfo', () => {
    expect(linuxMemory(meminfo, '', '').pressure).toBeUndefined();
  });
});

describe('windowsMemory', () => {
  it('breaksMemoryDown_andWorksPressureOutFromWhatIsAvailable', () => {
    const memory: MemoryBreakdown = windowsMemory(
      {
        memory: {
          PagesInputPersec: 500,
          PagesOutputPersec: 20,
          CacheBytes: 100,
          StandbyCacheNormalPriorityBytes: 1000,
          StandbyCacheReserveBytes: 10,
          StandbyCacheCoreBytes: 1,
          PoolNonpagedBytes: 300,
          FreeAndZeroPageListBytes: 400,
        },
        compressed: 250,
      },
      1000,
      150,
    );

    expect(memory).toEqual({
      wiredBytes: 300,
      compressedBytes: 250,
      cachedBytes: 1111,
      freeBytes: 400,
      pageIns: 500,
      pageOuts: 20,
      pressure: { level: 'warning', percent: 85 },
    });
  });
});

describe('darwinMemoryModules', () => {
  it('readsTheFilledSlots_countingTheEmptyOnes_andWhetherEccIsOn', () => {
    const modules: MemoryModules = darwinMemoryModules({
      SPMemoryDataType: [
        {
          global_ecc_state: 'ecc_enabled',
          _items: [
            { _name: 'Slot 1 (Channel F / DIMM 1)', dimm_size: 'empty', dimm_type: 'empty' },
            {
              _name: 'Slot 3 (Channel E / DIMM 1)',
              dimm_size: '32 GB',
              dimm_type: 'DDR4 R-DIMM',
              dimm_speed: '2400 MHz',
              dimm_status: 'ok',
              dimm_manufacturer: 'Samsung',
              dimm_part_number: 'M393A4K40CB1-CRC',
            },
          ],
        },
      ],
    });

    expect(modules).toEqual({
      modules: [
        {
          slot: 'Slot 3 (Channel E / DIMM 1)',
          sizeBytes: 32 * 1024 ** 3,
          type: 'DDR4 R-DIMM',
          speedMts: 2400,
          status: 'OK',
          manufacturer: 'Samsung',
          partNumber: 'M393A4K40CB1-CRC',
        },
      ],
      slots: 2,
      ecc: true,
    });
  });
});

describe('layoutMemoryModules', () => {
  it('readsSysteminformationsModules_leavingOutEmptySlots', () => {
    const modules: MemoryModules = layoutMemoryModules([
      {
        size: 16 * 1024 ** 3,
        bank: 'DIMM_A1',
        type: 'DDR5',
        ecc: false,
        clockSpeed: 5600,
        formFactor: 'DIMM',
        manufacturer: 'Kingston',
        partNum: 'KF556',
      },
      { size: 0, bank: 'DIMM_A2', type: '', clockSpeed: null, formFactor: '', partNum: '' },
    ]);

    expect(modules.modules).toEqual([
      {
        slot: 'DIMM_A1',
        sizeBytes: 16 * 1024 ** 3,
        type: 'DDR5 DIMM',
        speedMts: 5600,
        manufacturer: 'Kingston',
        partNumber: 'KF556',
      },
    ]);
    expect([modules.slots, modules.ecc]).toEqual([2, false]);
  });
});

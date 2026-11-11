import { describe, expect, it } from 'vitest';
import { bracket, cellValue, declaredType, nstring, sqlTypeName } from './sqlserver-values';

describe('sqlTypeName', () => {
  it('namesANullableIntegerFloatMoneyOrDate_byItsByteLength', () => {
    expect(
      [1, 2, 4, 8].map((dataLength: number) => sqlTypeName({ name: 'IntN', dataLength })),
    ).toEqual(['tinyint', 'smallint', 'int', 'bigint']);
    expect(sqlTypeName({ name: 'FloatN', dataLength: 4 })).toBe('real');
    expect(sqlTypeName({ name: 'MoneyN', dataLength: 8 })).toBe('money');
    expect(sqlTypeName({ name: 'DateTimeN', dataLength: 4 })).toBe('smalldatetime');
  });

  it('namesTheOtherTypes_inSqlServersOwnWords', () => {
    expect(sqlTypeName({ name: 'BitN' })).toBe('bit');
    expect(sqlTypeName({ name: 'NVarChar' })).toBe('nvarchar');
    expect(sqlTypeName({ name: 'DateTime2' })).toBe('datetime2');
  });
});

describe('cellValue', () => {
  it('keepsABigintExact_andANumberAsANumberWhenItFits', () => {
    expect(cellValue('9007199254740993', 'bigint')).toEqual({
      type: 'bigint',
      value: '9007199254740993',
    });
    expect(cellValue('42', 'bigint')).toBe(42);
  });

  it('showsBinaryBySizeAndPreview', () => {
    expect(cellValue(Buffer.from([0xde, 0xad]), 'varbinary')).toMatchObject({
      type: 'bytes',
      size: 2,
    });
  });

  it('writesADateOrTimeAsTheTypeAsks', () => {
    const at: Date = new Date(Date.UTC(2026, 10, 11, 14, 32, 7, 123));

    expect(cellValue(at, 'datetime2')).toEqual({
      type: 'temporal',
      value: '2026-11-11T14:32:07.123Z',
    });
    expect(cellValue(at, 'date')).toEqual({ type: 'temporal', value: '2026-11-11' });
    expect(cellValue(at, 'time')).toEqual({ type: 'temporal', value: '14:32:07.123' });
  });

  it('passesPrimitivesThrough_andNullAsNull', () => {
    expect(
      [1.5, true, 'x', null, undefined].map((value: unknown) => cellValue(value, 'any')),
    ).toEqual([1.5, true, 'x', null, null]);
  });
});

describe('declaredType', () => {
  it('writesLengthsPrecisionAndScale_asAScriptWould', () => {
    expect(declaredType('nvarchar', 100, 0, 0)).toBe('nvarchar(50)');
    expect(declaredType('varchar', -1, 0, 0)).toBe('varchar(max)');
    expect(declaredType('decimal', 9, 18, 2)).toBe('decimal(18, 2)');
    expect(declaredType('datetime2', 8, 27, 7)).toBe('datetime2(7)');
    expect(declaredType('int', 4, 10, 0)).toBe('int');
  });
});

describe('bracket and nstring', () => {
  it('escapeWhatWouldEndThem', () => {
    expect(bracket('odd]name')).toBe('[odd]]name]');
    expect(nstring("it's")).toBe("N'it''s'");
  });
});

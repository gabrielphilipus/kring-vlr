import { describe, expect, it } from 'vitest';
import {
  migrateV3ToV4,
  normalizeName,
  parseCounterNumber,
  parseNullableNumber,
} from '../electron/migrations/v4.cjs';

describe('Migration v4: Type Parsers and String Normalizers', () => {
  it('normalizes names ignoring accents and case', () => {
    expect(normalizeName('KAY/O')).toBe('kay/o');
    expect(normalizeName('Mecânica')).toBe('mecanica');
    expect(normalizeName('  Ascent  ')).toBe('ascent');
  });

  it('converts numbers strictly without turning empty strings or null into 0', () => {
    expect(parseNullableNumber(null)).toBeNull();
    expect(parseNullableNumber(undefined)).toBeNull();
    expect(parseNullableNumber('')).toBeNull();
    expect(parseNullableNumber('   ')).toBeNull();
    expect(parseNullableNumber('abc')).toBeNull();

    expect(parseNullableNumber(13)).toBe(13);
    expect(parseNullableNumber('13')).toBe(13);
    expect(parseNullableNumber('30.5')).toBe(30.5);
    expect(parseNullableNumber(30.5)).toBe(30.5);
  });

  it('falls back to 0 for counters like kills/deaths/assists', () => {
    expect(parseCounterNumber(null)).toBe(0);
    expect(parseCounterNumber(undefined)).toBe(0);
    expect(parseCounterNumber('')).toBe(0);
    expect(parseCounterNumber('15')).toBe(15);
    expect(parseCounterNumber(22)).toBe(22);
  });
});

describe('Migration v4: Pure migrateV3ToV4 Rules', () => {
  const catalogs = {
    maps: [
      { id: 'ascent', name: 'Ascent' },
      { id: 'haven', name: 'Haven' },
    ],
    agents: [
      { id: 'jett', name: 'Jett' },
      { id: 'kayo', name: 'KAY/O' },
    ],
  };

  it('is idempotent: migrating twice produces identical data', () => {
    const input = {
      schemaVersion: 3,
      vods: [
        {
          id: 'v1',
          title: 'Treino',
          map: 'Ascent',
          agent: 'Jett',
          roundsWon: '13',
          roundsLost: '7',
          kills: '18',
        },
      ],
      training: [{ id: 't1', title: 'Aim Lab', minutes: '25.5', done: 1 }],
      tactics: [{ id: 'tc1', title: 'Default', category: 'Roubo de ultimate' }],
    };

    const firstRun = migrateV3ToV4(input, { catalogs });
    const secondRun = migrateV3ToV4(firstRun.migrated, { catalogs });

    expect(firstRun.migrated).toEqual(secondRun.migrated);
    expect(secondRun.stats.fieldsConverted).toBe(0);
    expect(secondRun.stats.idsGenerated).toBe(0);
  });

  it('does NOT mutate the input object', () => {
    const input = {
      schemaVersion: 3,
      vods: [{ id: 'v1', roundsWon: '10' }],
    };
    const cloned = JSON.parse(JSON.stringify(input));

    migrateV3ToV4(input, { catalogs });

    expect(input).toEqual(cloned);
  });

  it('preserves unknown properties and legacy vod.gamePlan', () => {
    const input = {
      schemaVersion: 3,
      customGlobalTag: 'kring-vlr-custom',
      vods: [
        {
          id: 'v1',
          gamePlan: 'Anotação tática legada',
          untrackedMetric: 42,
        },
      ],
    };

    const { migrated } = migrateV3ToV4(input, { catalogs });

    expect(migrated.customGlobalTag).toBe('kring-vlr-custom');
    expect(migrated.vods[0].gamePlan).toBe('Anotação tática legada');
    expect(migrated.vods[0].untrackedMetric).toBe(42);
  });

  it('resolves known anomalies strictly according to specifications', () => {
    let idCounter = 1;
    const testIdGen = () => `generated-${idCounter++}`;

    const input = {
      vods: [
        {
          // Missing id
          title: 'Jogo 1',
          map: 'Ascent',
          agent: 'KAY/O',
          roundsWon: '13',
          roundsLost: '', // Empty string -> null (NOT 0!)
          kills: null, // -> 0
        },
        {
          id: 'v2',
          roundsWon: null, // Null remains null (NOT 0!)
          roundsLost: 'invalid', // Invalid string -> null
        },
      ],
      training: [
        {
          // Missing id
          title: 'Mecânica básica',
          minutes: '45.25', // Decimals preserved!
          done: undefined, // -> false
        },
      ],
      tactics: [
        {
          id: 'tac1',
          title: 'Exec A',
          category: 'Roubo de ultimate', // -> 'Rounds de ultimate'
        },
      ],
    };

    const { migrated, stats } = migrateV3ToV4(input, {
      catalogs,
      idGenerator: testIdGen,
    });

    // 1. Missing IDs generated
    expect(migrated.vods[0].id).toBe('generated-1');
    expect(migrated.training[0].id).toBe('generated-2');
    expect(stats.idsGenerated).toBe(2);

    // 2. roundsWon/roundsLost conversions
    expect(migrated.vods[0].roundsWon).toBe(13);
    expect(migrated.vods[0].roundsLost).toBeNull();
    expect(migrated.vods[0].kills).toBe(0);
    expect(migrated.vods[1].roundsWon).toBeNull();
    expect(migrated.vods[1].roundsLost).toBeNull();

    // 3. Training minutes & done
    expect(migrated.training[0].minutes).toBe(45.25);
    expect(migrated.training[0].done).toBe(false);

    // 4. Tactics category migration
    expect(migrated.tactics[0].category).toBe('Rounds de ultimate');

    // 5. Automatic link resolution
    expect(migrated.vods[0].mapId).toBe('ascent');
    expect(migrated.vods[0].agentId).toBe('kayo');
  });

  it('rejects files with schemaVersion higher than supported', () => {
    const input = {
      schemaVersion: 99,
      vods: [],
    };

    expect(() => migrateV3ToV4(input, { catalogs })).toThrowError(
      /Versão de dados incompatível/
    );
  });
});

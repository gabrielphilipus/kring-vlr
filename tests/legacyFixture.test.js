import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrateV3ToV4 } from '../electron/migrations/v4.cjs';

describe('Legacy Fixture Migration (tests/fixtures/legacy-v2.json)', () => {
  const fixturePath = path.resolve(__dirname, 'fixtures/legacy-v2.json');
  const rawContent = fs.readFileSync(fixturePath, 'utf8');
  const legacyData = JSON.parse(rawContent);

  const testCatalogs = {
    maps: [
      { id: 'fracture', name: 'Fracture' },
      { id: 'haven', name: 'Haven' },
      { id: 'ascent', name: 'Ascent' },
    ],
    agents: [
      { id: 'kayo', name: 'KAY/O' },
      { id: 'jett', name: 'Jett' },
      { id: 'omen', name: 'Omen' },
    ],
  };

  it('migrates the legacy fixture matching the handcrafted expected output exactly', () => {
    let idCounter = 1;
    const testIdGenerator = () => `mock-id-${idCounter++}`;

    const { migrated, stats } = migrateV3ToV4(legacyData, {
      catalogs: testCatalogs,
      idGenerator: testIdGenerator,
    });

    const expectedOutput = {
      customRootMeta: 'valorant-custom-v1',
      schemaVersion: 4,
      vods: [
        {
          id: 'mock-id-1',
          title: 'VOD com strings vazias e espacos',
          map: 'fracture',
          agent: 'KAY/O',
          mapId: 'fracture',
          agentId: 'kayo',
          roundsWon: null,
          roundsLost: null,
          kills: 15,
          deaths: 10,
          assists: 5,
          gamePlan: 'Estratégia legada v1',
          extraVodNote: 'observacao_extra',
        },
        {
          id: 'vod-2',
          title: 'VOD com strings numericas',
          map: 'HAVEN',
          agent: 'jett',
          mapId: 'haven',
          agentId: 'jett',
          roundsWon: 13,
          roundsLost: 7,
          kills: 0,
          deaths: 0,
          assists: 0,
        },
        {
          id: 'vod-3',
          title: 'VOD com numeros ja corretos',
          map: 'Ascent',
          agent: 'Omen',
          mapId: 'ascent',
          agentId: 'omen',
          roundsWon: 13,
          roundsLost: 7,
          kills: 20,
          deaths: 12,
          assists: 8,
        },
        {
          id: 'vod-4',
          title: 'VOD com valores nulos',
          map: 'MapaInexistente',
          agent: 'AgenteInexistente',
          mapId: null,
          agentId: null,
          roundsWon: null,
          roundsLost: null,
          kills: 0,
          deaths: 0,
          assists: 0,
        },
        {
          id: 'vod-5',
          title: 'VOD com rounds omitidos e strings invalidas',
          map: 'Ascent',
          agent: 'Jett',
          mapId: 'ascent',
          agentId: 'jett',
          roundsWon: null,
          roundsLost: null,
          kills: 0,
          deaths: 0,
          assists: 0,
        },
      ],
      lineups: [
        {
          id: 'mock-id-2',
          title: 'Lineup sem id e com mapa em minusculas',
          map: 'fracture',
          agent: 'KAY/O',
          mapId: 'fracture',
          agentId: 'kayo',
          customLineupFlag: true,
        },
        {
          id: 'l-2',
          title: 'Lineup com mapa inexistente',
          map: 'MapaInexistente',
          agent: 'AgenteInexistente',
          mapId: null,
          agentId: null,
        },
      ],
      tactics: [],
      training: [
        {
          id: 'mock-id-3',
          title: 'Treino sem id, minutes decimal como string e done ausente',
          minutes: 1.5,
          done: false,
        },
        {
          id: 'tr-2',
          title: 'Treino com done true e minutes numero',
          minutes: 30,
          done: true,
        },
      ],
      gameplans: [],
      maps: [
        {
          id: 'mock-id-4',
          name: 'Mapa Custom sem ID',
          previewUrl: '',
          competitiveActive: true,
        },
      ],
      agents: [
        {
          id: 'mock-id-5',
          name: 'Agente Custom sem ID',
          role: 'Duelista',
          iconUrl: '',
          active: true,
        },
      ],
    };

    expect(migrated).toEqual(expectedOutput);

    // Verifies stats
    expect(stats.schemaVersionBefore).toBe('legacy (sem versão)');
    expect(stats.schemaVersionAfter).toBe(4);
    expect(stats.idsGenerated).toBe(5);
    expect(stats.unlinkedMaps).toContain('MapaInexistente');
    expect(stats.unlinkedAgents).toContain('AgenteInexistente');
  });

  it('guarantees that running migration twice on the output produces 0 changes (idempotency)', () => {
    let idCounter = 100;
    const testIdGenerator = () => `extra-id-${idCounter++}`;

    const pass1 = migrateV3ToV4(legacyData, {
      catalogs: testCatalogs,
      idGenerator: testIdGenerator,
    });

    const pass2 = migrateV3ToV4(pass1.migrated, {
      catalogs: testCatalogs,
      idGenerator: testIdGenerator,
    });

    expect(pass2.migrated).toEqual(pass1.migrated);
    expect(pass2.stats.fieldsConverted).toBe(0);
    expect(pass2.stats.idsGenerated).toBe(0);
    expect(pass2.stats.linksPopulated).toBe(0);
  });
});

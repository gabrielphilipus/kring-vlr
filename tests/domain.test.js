import { describe, expect, it } from 'vitest';
import {
  cascadeRenameCatalogItem,
  isCatalogItemInUse,
  toggleAgentActive,
  toggleMapActive,
} from '../src/domain/catalog.js';
import { unlinkGameplanFromVods } from '../src/domain/gameplans.js';
import {
  toggleTrainingItem,
  toggleTrainingWeekItems,
} from '../src/domain/training.js';

describe('Domain Rules: Catalog', () => {
  it('correctly detects if a map is in use', () => {
    const data = {
      vods: [{ id: '1', map: 'Ascent', mapId: 'm1' }],
      lineups: [],
      tactics: [],
      gameplans: [],
    };
    expect(
      isCatalogItemInUse(data, { type: 'map', id: 'm1', name: 'Ascent' })
    ).toBe(true);
    expect(
      isCatalogItemInUse(data, { type: 'map', id: 'm2', name: 'Haven' })
    ).toBe(false);
  });

  it('correctly detects if an agent is in use in agents list of a gameplan', () => {
    const data = {
      vods: [],
      lineups: [],
      gameplans: [{ id: 'gp1', agents: ['Jett', 'Omen'] }],
    };
    expect(
      isCatalogItemInUse(data, { type: 'agent', id: 'a1', name: 'Jett' })
    ).toBe(true);
    expect(
      isCatalogItemInUse(data, { type: 'agent', id: 'a2', name: 'Sova' })
    ).toBe(false);
  });

  it('cascades map renaming across vods, lineups, tactics, and gameplans without mutating input', () => {
    const original = {
      vods: [{ id: 'v1', map: 'Bind', mapId: 'bind-id' }],
      lineups: [{ id: 'l1', map: 'Bind', mapId: null }],
      tactics: [{ id: 't1', map: 'Bind', mapId: 'bind-id' }],
      gameplans: [{ id: 'g1', map: 'Bind', mapId: 'bind-id' }],
    };
    const clonedSnapshot = JSON.parse(JSON.stringify(original));

    const updated = cascadeRenameCatalogItem(original, {
      isAgent: false,
      oldName: 'Bind',
      record: { id: 'bind-id', name: 'Novo Bind' },
    });

    // Validates cascade
    expect(updated.vods[0].map).toBe('Novo Bind');
    expect(updated.lineups[0].map).toBe('Novo Bind');
    expect(updated.lineups[0].mapId).toBe('bind-id');
    expect(updated.tactics[0].map).toBe('Novo Bind');
    expect(updated.gameplans[0].map).toBe('Novo Bind');

    // Validates immutability
    expect(original).toEqual(clonedSnapshot);
  });

  it('cascades agent renaming including gameplans agents array without mutating input', () => {
    const original = {
      vods: [{ id: 'v1', agent: 'Jett', agentId: 'jett-id' }],
      lineups: [{ id: 'l1', agent: 'Jett', agentId: null }],
      tactics: [],
      gameplans: [{ id: 'g1', agents: ['Jett', 'Sova'] }],
    };
    const clonedSnapshot = JSON.parse(JSON.stringify(original));

    const updated = cascadeRenameCatalogItem(original, {
      isAgent: true,
      oldName: 'Jett',
      record: { id: 'jett-id', name: 'Jett V2' },
    });

    expect(updated.vods[0].agent).toBe('Jett V2');
    expect(updated.lineups[0].agent).toBe('Jett V2');
    expect(updated.gameplans[0].agents).toEqual(['Jett V2', 'Sova']);

    // Validates immutability
    expect(original).toEqual(clonedSnapshot);
  });

  it('toggles map active and agent active immutably', () => {
    const maps = [{ id: 'm1', competitiveActive: true }];
    const toggledMaps = toggleMapActive(maps, 'm1');
    expect(toggledMaps[0].competitiveActive).toBe(false);
    expect(maps[0].competitiveActive).toBe(true);

    const agents = [{ id: 'a1', active: false }];
    const toggledAgents = toggleAgentActive(agents, 'a1');
    expect(toggledAgents[0].active).toBe(true);
    expect(agents[0].active).toBe(false);
  });
});

describe('Domain Rules: Gameplans', () => {
  it('unlinks gameplanId from matching VODs immutably', () => {
    const vods = [
      { id: 'v1', gameplanId: 'plan-1' },
      { id: 'v2', gameplanId: 'plan-2' },
      { id: 'v3', gameplanId: null },
    ];
    const cloned = JSON.parse(JSON.stringify(vods));

    const unlinked = unlinkGameplanFromVods(vods, 'plan-1');

    expect(unlinked[0].gameplanId).toBeNull();
    expect(unlinked[1].gameplanId).toBe('plan-2');
    expect(unlinked[2].gameplanId).toBeNull();

    // Validates immutability
    expect(vods).toEqual(cloned);
  });
});

describe('Domain Rules: Training', () => {
  it('toggles a single training item done status immutably', () => {
    const items = [
      { id: 't1', done: false },
      { id: 't2', done: true },
    ];
    const cloned = JSON.parse(JSON.stringify(items));

    const updated = toggleTrainingItem(items, 't1');
    expect(updated[0].done).toBe(true);
    expect(updated[1].done).toBe(true);
    expect(items).toEqual(cloned);
  });

  it('toggles all items of a week to markDone immutably', () => {
    const items = [
      { id: 't1', done: false },
      { id: 't2', done: false },
      { id: 't3', done: false },
    ];
    const weekItems = [{ id: 't1' }, { id: 't2' }];

    const updated = toggleTrainingWeekItems(items, weekItems, true);
    expect(updated[0].done).toBe(true);
    expect(updated[1].done).toBe(true);
    expect(updated[2].done).toBe(false);
  });
});

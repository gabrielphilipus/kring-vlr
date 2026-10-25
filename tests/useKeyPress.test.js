import { describe, expect, it } from 'vitest';
import { useKeyPress } from '../src/hooks/useKeyPress.js';

describe('useKeyPress', () => {
  it('exporta a função useKeyPress corretamente', () => {
    expect(typeof useKeyPress).toBe('function');
  });
});

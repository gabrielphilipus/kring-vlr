import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FILTER_TRAINING_CATEGORIES,
  TRAINING_CATEGORIES,
} from '../src/constants/training.js';
import { slugifyCategory } from '../src/utils/string.js';

describe('TRAINING_CATEGORIES canonical union', () => {
  it('contains all 10 unified categories without duplicates', () => {
    expect(TRAINING_CATEGORIES).toHaveLength(10);
    const unique = new Set(TRAINING_CATEGORIES);
    expect(unique.size).toBe(10);

    // Includes all original modal categories
    expect(TRAINING_CATEGORIES).toContain('Mecânica');
    expect(TRAINING_CATEGORIES).toContain('Mira');
    expect(TRAINING_CATEGORIES).toContain('Movimentação');
    expect(TRAINING_CATEGORIES).toContain('Utilitários');
    expect(TRAINING_CATEGORIES).toContain('VOD review');
    expect(TRAINING_CATEGORIES).toContain('Mental');

    // Includes all original page categories
    expect(TRAINING_CATEGORIES).toContain('Posicionamento');
    expect(TRAINING_CATEGORIES).toContain('Comunicação');
    expect(TRAINING_CATEGORIES).toContain('Tático');
    expect(TRAINING_CATEGORIES).toContain('Geral');
  });

  it('provides FILTER_TRAINING_CATEGORIES prefixed with "Todas"', () => {
    expect(FILTER_TRAINING_CATEGORIES[0]).toBe('Todas');
    expect(FILTER_TRAINING_CATEGORIES.slice(1)).toEqual(TRAINING_CATEGORIES);
  });

  it('guarantees matching CSS classes in styles.css for every category', () => {
    const cssPath = path.resolve(__dirname, '../src/styles.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    for (const cat of TRAINING_CATEGORIES) {
      const slug = slugifyCategory(cat);
      // Checks both the badge class (.cat-<slug>) and filter chip (.cat-chip-<slug>)
      expect(
        cssContent.includes(`.cat-${slug}`) ||
          cssContent.includes(`.cat-${cat.toLowerCase()}`)
      ).toBe(true);
      expect(
        cssContent.includes(`.cat-chip-${slug}`) ||
          cssContent.includes(`.cat-chip-${cat.toLowerCase()}`)
      ).toBe(true);
    }
  });
});

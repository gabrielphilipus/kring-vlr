import { describe, expect, it } from 'vitest';
import {
  levenshtein,
  normalizeUrl,
  slugifyCategory,
  uid,
} from '../src/utils/string.js';

describe('string utils', () => {
  describe('levenshtein', () => {
    it('calcula casos conhecidos corretamente', () => {
      expect(levenshtein('kitten', 'sitting')).toBe(3);
      expect(levenshtein('saturday', 'sunday')).toBe(3);
      expect(levenshtein('valorant', 'valorant')).toBe(0);
    });

    it('trata strings vazias e iguais', () => {
      expect(levenshtein('', '')).toBe(0);
      expect(levenshtein('teste', '')).toBe(5);
      expect(levenshtein('', 'teste')).toBe(5);
    });

    it('trata valores não-string ou nulos com segurança', () => {
      expect(levenshtein(null, 'abc')).toBe(3);
      expect(levenshtein('abc', undefined)).toBe(3);
      expect(levenshtein(null, null)).toBe(0);
    });
  });

  describe('slugifyCategory', () => {
    it('converte categorias para slug CSS com hífens', () => {
      expect(slugifyCategory('Mira / Mecânica')).toBe('mira-mecânica');
      expect(slugifyCategory('Posicionamento')).toBe('posicionamento');
      expect(slugifyCategory('Utilidade / Espaço')).toBe('utilidade-espaço');
    });

    it('usa default se categoria for vazia ou nula', () => {
      expect(slugifyCategory('')).toBe('mecânica');
      expect(slugifyCategory(null)).toBe('mecânica');
      expect(slugifyCategory(undefined)).toBe('mecânica');
      expect(slugifyCategory(null, 'Geral')).toBe('geral');
    });
  });

  describe('normalizeUrl', () => {
    it('preserva URLs completas com http ou https', () => {
      expect(normalizeUrl('https://youtube.com/watch?v=123')).toBe(
        'https://youtube.com/watch?v=123'
      );
      expect(normalizeUrl('http://twitch.tv/streamer')).toBe(
        'http://twitch.tv/streamer'
      );
    });

    it('adiciona https:// para domínios comuns como youtube e twitch', () => {
      expect(normalizeUrl('youtube.com/watch?v=123')).toBe(
        'https://youtube.com/watch?v=123'
      );
      expect(normalizeUrl('www.youtube.com/watch?v=123')).toBe(
        'https://www.youtube.com/watch?v=123'
      );
      expect(normalizeUrl('twitch.tv/canal')).toBe('https://twitch.tv/canal');
    });

    it('retorna string vazia para entradas nulas ou vazias', () => {
      expect(normalizeUrl('')).toBe('');
      expect(normalizeUrl(null)).toBe('');
      expect(normalizeUrl(undefined)).toBe('');
    });
  });

  describe('uid', () => {
    it('garante unicidade em 1000 chamadas consecutivas', () => {
      const generated = new Set();
      for (let i = 0; i < 1000; i++) {
        const id = uid();
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(5);
        expect(generated.has(id)).toBe(false);
        generated.add(id);
      }
      expect(generated.size).toBe(1000);
    });
  });
});

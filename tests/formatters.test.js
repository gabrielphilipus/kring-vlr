import { describe, expect, it, vi } from 'vitest';
import {
  formatDate,
  formatSeconds,
  parseTimeToSeconds,
  percent,
  today,
} from '../src/utils/formatters.js';

describe('formatters', () => {
  describe('percent', () => {
    it('formata números válidos com até 1 casa decimal', () => {
      expect(percent(50)).toBe('50%');
      expect(percent(66.666)).toBe('66.7%');
      expect(percent(100)).toBe('100%');
      expect(percent(0)).toBe('0%');
    });

    it('trata valores vazios, nulos, indefinidos e inválidos', () => {
      expect(percent(null)).toBe('0%');
      expect(percent(undefined)).toBe('0%');
      expect(percent('invalido')).toBe('0%');
      expect(percent(NaN)).toBe('0%');
    });
  });

  describe('formatDate', () => {
    it('formata strings YYYY-MM-DD para DD/MM/AAAA sem recuar dia em UTC-3', () => {
      expect(formatDate('2026-10-25')).toBe('25/10/2026');
      expect(formatDate('2026-01-01')).toBe('01/01/2026');
      expect(formatDate('2026-12-31')).toBe('31/12/2026');
    });

    it('devolve — para valores vazios ou não strings', () => {
      expect(formatDate('')).toBe('—');
      expect(formatDate(null)).toBe('—');
      expect(formatDate(undefined)).toBe('—');
    });

    it('devolve o próprio texto se a data for inválida', () => {
      expect(formatDate('data-invalida')).toBe('data-invalida');
    });
  });

  describe('parseTimeToSeconds', () => {
    it('converte MM:SS para segundos', () => {
      expect(parseTimeToSeconds('01:30')).toBe(90);
      expect(parseTimeToSeconds('00:00')).toBe(0);
      expect(parseTimeToSeconds('10:15')).toBe(615);
    });

    it('converte HH:MM:SS para segundos', () => {
      expect(parseTimeToSeconds('01:00:00')).toBe(3600);
      expect(parseTimeToSeconds('01:02:03')).toBe(3723);
    });

    it('devolve 0 para valores vazios ou inválidos', () => {
      expect(parseTimeToSeconds('')).toBe(0);
      expect(parseTimeToSeconds(null)).toBe(0);
      expect(parseTimeToSeconds(undefined)).toBe(0);
      expect(parseTimeToSeconds('invalido')).toBe(0);
      expect(parseTimeToSeconds('aa:bb')).toBe(0);
    });
  });

  describe('formatSeconds', () => {
    it('formata segundos para MM:SS', () => {
      expect(formatSeconds(0)).toBe('00:00');
      expect(formatSeconds(90)).toBe('01:30');
      expect(formatSeconds(3665)).toBe('61:05');
    });

    it('lida com números negativos e entradas inválidas', () => {
      expect(formatSeconds(-10)).toBe('00:00');
      expect(formatSeconds(null)).toBe('00:00');
      expect(formatSeconds('abc')).toBe('00:00');
    });
  });

  describe('today', () => {
    it('retorna data no formato YYYY-MM-DD às 23:30 local', () => {
      vi.useFakeTimers();
      // Criar data local às 23:30 de 25/10/2026
      const fakeLocal = new Date(2026, 9, 25, 23, 30, 0); // mês 9 = Outubro
      vi.setSystemTime(fakeLocal);

      const result = today();
      expect(result).toBe('2026-10-25');

      vi.useRealTimers();
    });
  });
});

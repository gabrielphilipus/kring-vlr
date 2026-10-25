import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard } from '../src/utils/clipboard.js';

describe('clipboard utils', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retorna true quando navigator.clipboard.writeText tem sucesso', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    const success = await copyToClipboard('mensagem');
    expect(success).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith('mensagem');
  });

  it('retorna true quando writeText falha mas o fallback com execCommand tem sucesso', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('Permissão negada')),
      },
    });

    const mockTextarea = {
      value: '',
      style: {},
      setAttribute: vi.fn(),
      select: vi.fn(),
    };

    vi.stubGlobal('document', {
      createElement: vi.fn().mockReturnValue(mockTextarea),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
      execCommand: vi.fn().mockReturnValue(true),
    });

    const success = await copyToClipboard('mensagem fallback');
    expect(success).toBe(true);
    expect(mockTextarea.value).toBe('mensagem fallback');
    expect(mockTextarea.select).toHaveBeenCalled();
  });

  it('retorna false quando ambos writeText e execCommand falham', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('Permissão negada')),
      },
    });

    vi.stubGlobal('document', {
      createElement: vi.fn().mockReturnValue({
        value: '',
        style: {},
        setAttribute: vi.fn(),
        select: vi.fn(),
      }),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
      execCommand: vi.fn().mockReturnValue(false),
    });

    const success = await copyToClipboard('mensagem erro');
    expect(success).toBe(false);
  });
});

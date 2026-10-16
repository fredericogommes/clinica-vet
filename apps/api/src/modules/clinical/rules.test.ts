import { describe, expect, it } from 'vitest';
import { sniffImageType } from './image-type.js';
import { renderTemplate } from './render.js';

describe('renderTemplate', () => {
  it('preenche campos conhecidos, mantém desconhecidos e marca vazios', () => {
    expect(
      renderTemplate('{{animal}} / {{ raca }} / {{peso}} / {{nada}} / {animal}', {
        animal: 'Thor',
        raca: 'SRD',
        peso: null,
      }),
    ).toBe('Thor / SRD / não informado / {{nada}} / {animal}');
  });

  it('não interpreta o valor como modelo', () => {
    expect(renderTemplate('{{animal}}', { animal: '{{responsavel}}', responsavel: 'X' })).toBe(
      '{{responsavel}}',
    );
  });
});

describe('sniffImageType', () => {
  it('reconhece JPEG, PNG e WebP pelos bytes iniciais', () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(
      'image/png',
    );
    expect(sniffImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
  });

  it('recusa SVG, HTML, GIF e arquivos curtos', () => {
    for (const text of ['<svg/>', '<html>', 'GIF89a', 'RIFF', '']) {
      expect(sniffImageType(Buffer.from(text))).toBeNull();
    }
  });
});

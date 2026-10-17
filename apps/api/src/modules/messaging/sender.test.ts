import { describe, expect, it } from 'vitest';
import { CloudApiSender } from './sender.js';

const config = {
  token: 'token-de-teste',
  phoneNumberId: '1234567890',
  apiUrl: 'https://graph.example.test/v21.0',
  language: 'pt_BR',
};

describe('CloudApiSender', () => {
  it('sem token ou número fica desligado e não chama a API', async () => {
    const sender = new CloudApiSender({ ...config, token: undefined }, () => {
      throw new Error('não deveria chamar');
    });
    expect(sender.configured).toBe(false);
    await expect(sender.send({ phone: '11987654321', template: 'x', params: [] })).rejects.toThrow(
      'WhatsApp não configurado',
    );
  });

  it('envia o modelo aprovado com DDI 55 e as variáveis como parâmetros, na ordem', async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const sender = new CloudApiSender(config, async (url, init) => {
      requests.push({ url: url as string, init: init ?? {} });
      return Response.json({ messages: [{ id: 'wamid.ABC' }] });
    });
    const result = await sender.send({
      phone: '11987654321',
      template: 'lembrete_vacina',
      params: ['Carla', 'Antirrábica'],
    });
    expect(result).toEqual({ id: 'wamid.ABC' });
    const [request] = requests;
    expect(request?.url).toBe('https://graph.example.test/v21.0/1234567890/messages');
    expect((request?.init.headers as Record<string, string>).authorization).toBe(
      'Bearer token-de-teste',
    );
    expect(JSON.parse(request?.init.body as string)).toEqual({
      messaging_product: 'whatsapp',
      to: '5511987654321',
      type: 'template',
      template: {
        name: 'lembrete_vacina',
        language: { code: 'pt_BR' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Carla' },
              { type: 'text', text: 'Antirrábica' },
            ],
          },
        ],
      },
    });
  });

  it('erro da Meta vira mensagem legível, sem o token', async () => {
    const sender = new CloudApiSender(config, async () =>
      Response.json({ error: { message: 'Template name does not exist' } }, { status: 404 }),
    );
    const failure = sender.send({ phone: '11987654321', template: 'nao_existe', params: [] });
    await expect(failure).rejects.toThrow('WhatsApp recusou (404): Template name does not exist');
    await expect(failure).rejects.not.toThrow('token-de-teste');
  });
});

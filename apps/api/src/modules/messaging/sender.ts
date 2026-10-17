/** Envio de uma mensagem já gerada; o celular vem só com DDD e número. */
export interface MessageSender {
  readonly configured: boolean;
  send(input: { phone: string; template: string; params: string[] }): Promise<{ id: string }>;
}

export interface CloudApiConfig {
  token: string | undefined;
  phoneNumberId: string | undefined;
  apiUrl: string;
  language: string;
}

/**
 * WhatsApp Business pela API oficial da Meta (Cloud API). Mensagem iniciada pela clínica só
 * sai por modelo aprovado na Meta, com as variáveis do texto como parâmetros, na mesma ordem.
 * Sem token e número configurados, nada é enviado e a fila fica com a recepção.
 */
export class CloudApiSender implements MessageSender {
  constructor(
    private readonly config: CloudApiConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get configured(): boolean {
    return Boolean(this.config.token && this.config.phoneNumberId);
  }

  async send(input: { phone: string; template: string; params: string[] }) {
    if (!this.configured) throw new Error('WhatsApp não configurado');
    const response = await this.fetchImpl(
      `${this.config.apiUrl}/${String(this.config.phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${String(this.config.token)}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: `55${input.phone}`,
          type: 'template',
          template: {
            name: input.template,
            language: { code: this.config.language },
            components:
              input.params.length > 0
                ? [
                    {
                      type: 'body',
                      parameters: input.params.map((text) => ({ type: 'text', text })),
                    },
                  ]
                : [],
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const body = (await response.json().catch(() => null)) as {
      messages?: { id?: string }[];
      error?: { message?: string };
    } | null;
    if (!response.ok) {
      throw new Error(
        `WhatsApp recusou (${String(response.status)}): ${body?.error?.message ?? 'sem detalhe'}`,
      );
    }
    const id = body?.messages?.[0]?.id;
    if (!id) throw new Error('WhatsApp não devolveu o identificador da mensagem');
    return { id };
  }
}

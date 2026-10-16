import { formatCnpj, formatCpf, formatPhone } from '@clinica/contracts';

export const formatDocument = (value: string | null): string | null => {
  if (!value) return null;
  return value.length === 14 ? formatCnpj(value) : formatCpf(value);
};

export { formatPhone };

/** Link de conversa no WhatsApp para celular brasileiro (DDI 55). */
export const whatsappUrl = (digits: string): string => `https://wa.me/55${digits}`;

const date = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' });
/** Datas sem horário (nascimento, óbito) vêm como AAAA-MM-DD e não devem sofrer fuso. */
export const formatDate = (iso: string): string => date.format(new Date(`${iso}T00:00:00Z`));

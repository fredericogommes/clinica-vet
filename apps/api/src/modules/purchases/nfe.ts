import { XMLParser } from 'fast-xml-parser';
import { AppError } from '../../core/errors.js';

/** O que a compra aproveita de uma NF-e: emitente, itens com lote, totais e duplicatas. */
export interface ParsedNfe {
  key: string;
  number: string;
  series: string;
  issuedOn: string | null;
  supplier: { document: string; name: string; phone: string; email: string };
  items: {
    supplierCode: string;
    ean: string;
    description: string;
    supplierUnit: string;
    quantity: number;
    total: number;
    lot: { code: string; expiresOn: string } | null;
  }[];
  freight: number;
  otherCosts: number;
  discount: number;
  installments: { dueDate: string; amount: number }[];
}

const unreadable = (message: string) =>
  new AppError('validation_failed', `${message}.`, [{ path: 'xml', message }]);

type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const child = (node: unknown, name: string): Node | undefined => {
  if (!isNode(node)) return undefined;
  const value = node[name];
  return isNode(value) ? value : undefined;
};

const list = (node: unknown, name: string): Node[] => {
  if (!isNode(node)) return [];
  const value = node[name];
  if (Array.isArray(value)) return value.filter(isNode);
  return isNode(value) ? [value] : [];
};

const str = (node: unknown, name: string): string => {
  if (!isNode(node)) return '';
  const value = node[name];
  return typeof value === 'string' ? value.trim() : '';
};

const num = (node: unknown, name: string): number => {
  const value = Number(str(node, name));
  return Number.isFinite(value) ? value : 0;
};

const round = (value: number, places: number) => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

const isoDate = (value: string): string | null =>
  /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;

/** GTIN válido ou vazio: a nota traz "SEM GTIN" quando o produto não tem código de barras. */
const gtin = (value: string) => (/^\d{8,14}$/.test(value) ? value : '');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ['det', 'dup', 'rastro'].includes(name),
});

/**
 * Lê o XML da NF-e (com ou sem o protocolo de autorização). Não resolve entidades externas: XML
 * com DOCTYPE é recusado antes de chegar ao parser.
 */
export function parseNfe(xml: string): ParsedNfe {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw unreadable('O arquivo não é um XML de NF-e');
  // O parser tolera XML malformado; o que importa é achar a estrutura da NF-e logo abaixo.
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch {
    throw unreadable('O arquivo não é um XML válido');
  }
  const nfe = child(child(doc, 'nfeProc'), 'NFe') ?? child(doc, 'NFe');
  const inf = child(nfe, 'infNFe');
  if (!inf) throw unreadable('O arquivo não é um XML de NF-e');
  const key = str(inf, '@Id').replace(/\D/g, '');
  if (key.length !== 44) throw unreadable('A nota não traz a chave de acesso');
  const ide = child(inf, 'ide');
  const emit = child(inf, 'emit');
  const document = str(emit, 'CNPJ') || str(emit, 'CPF');
  const name = str(emit, 'xNome');
  if (!document || !name) throw unreadable('A nota não identifica o emitente');
  const address = child(emit, 'enderEmit');

  const items: ParsedNfe['items'] = [];
  for (const det of list(inf, 'det')) {
    const prod = child(det, 'prod');
    if (!prod) continue;
    const base = {
      supplierCode: str(prod, 'cProd').slice(0, 60),
      ean: gtin(str(prod, 'cEAN')),
      description: str(prod, 'xProd').slice(0, 200),
      supplierUnit: str(prod, 'uCom').slice(0, 10),
    };
    const quantity = num(prod, 'qCom');
    const total = round(num(prod, 'vProd'), 2);
    // Item com mais de um lote vira uma linha por lote, com o valor dividido pela quantidade.
    const lots = list(prod, 'rastro')
      .map((r) => ({
        code: str(r, 'nLote').toUpperCase().slice(0, 40),
        expiresOn: isoDate(str(r, 'dVal')),
        quantity: num(r, 'qLote'),
      }))
      .filter((r) => r.code && r.expiresOn && r.quantity > 0);
    const lotTotal = lots.reduce((sum, l) => sum + l.quantity, 0);
    if (lots.length > 1 && Math.abs(lotTotal - quantity) < 0.0005) {
      let left = Math.round(total * 100);
      lots.forEach((l, i) => {
        const cents =
          i === lots.length - 1 ? left : Math.round((total * 100 * l.quantity) / quantity);
        left -= cents;
        items.push({
          ...base,
          quantity: round(l.quantity, 3),
          total: cents / 100,
          lot: { code: l.code, expiresOn: l.expiresOn ?? '' },
        });
      });
      continue;
    }
    const lot = lots[0];
    items.push({
      ...base,
      quantity: round(quantity, 3),
      total,
      lot: lot && lots.length === 1 ? { code: lot.code, expiresOn: lot.expiresOn ?? '' } : null,
    });
  }
  if (items.length === 0) throw unreadable('A nota não tem itens');

  const totals = child(child(inf, 'total'), 'ICMSTot');
  const goods = round(num(totals, 'vProd'), 2);
  const freight = round(num(totals, 'vFrete'), 2);
  let discount = round(num(totals, 'vDesc'), 2);
  // Seguro, outras despesas, IPI e ST: o que a nota soma além dos itens e do frete.
  let otherCosts = round(num(totals, 'vNF') - goods - freight + discount, 2);
  if (otherCosts < 0) {
    discount = round(discount - otherCosts, 2);
    otherCosts = 0;
  }
  const installments = list(child(inf, 'cobr'), 'dup')
    .map((d) => ({ dueDate: isoDate(str(d, 'dVenc')), amount: round(num(d, 'vDup'), 2) }))
    .filter((d): d is { dueDate: string; amount: number } => d.dueDate !== null && d.amount > 0);

  return {
    key,
    number: str(ide, 'nNF').slice(0, 20),
    series: str(ide, 'serie').slice(0, 5),
    issuedOn: isoDate(str(ide, 'dhEmi') || str(ide, 'dEmi')),
    supplier: {
      document: document.replace(/\D/g, ''),
      name: name.slice(0, 120),
      phone: str(address, 'fone').replace(/\D/g, '').slice(0, 20),
      email: '',
    },
    items,
    freight,
    otherCosts,
    discount,
    installments,
  };
}

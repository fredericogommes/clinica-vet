import type { TemplatePlaceholder } from '@clinica/contracts';

/**
 * Preenche {{campo}} com os dados do animal. Campo desconhecido fica como está, para quem escreveu
 * o modelo perceber o erro; campo sem valor vira "não informado".
 */
export function renderTemplate(
  text: string,
  values: Partial<Record<TemplatePlaceholder, string | null>>,
): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) => {
    if (!Object.hasOwn(values, key)) return match;
    const value = values[key as TemplatePlaceholder];
    return value === null || value === undefined || value === '' ? 'não informado' : value;
  });
}

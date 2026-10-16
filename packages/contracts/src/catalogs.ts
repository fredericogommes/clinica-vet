import { z } from 'zod';

export const catalogKinds = [
  'species',
  'coats',
  'client-origins',
  'product-groups',
  'product-brands',
] as const;
export type CatalogKind = (typeof catalogKinds)[number];

export const catalogItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  archived: z.boolean(),
});
export type CatalogItem = z.infer<typeof catalogItemSchema>;

export const breedSchema = catalogItemSchema.extend({ speciesId: z.uuid() });
export type Breed = z.infer<typeof breedSchema>;

export const catalogItemInputSchema = z.object({
  name: z.string().trim().min(2, 'Mínimo de 2 caracteres').max(80, 'Máximo de 80 caracteres'),
  archived: z.boolean().default(false),
});
export type CatalogItemInput = z.input<typeof catalogItemInputSchema>;

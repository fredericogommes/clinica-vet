import { uuidv7 } from 'uuidv7';

/** UUID v7: ordenável por tempo, bom para índices B-tree. */
export const newId = (): string => uuidv7();

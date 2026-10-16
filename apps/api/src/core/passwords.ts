import { hash, verify } from '@node-rs/argon2';

// Parâmetros recomendados pela OWASP para argon2id (19 MiB, 2 iterações).
const options = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string): Promise<string> => hash(password, options);

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Hash de uma senha aleatória para igualar o tempo de resposta quando o e-mail não existe. */
let dummyHash: Promise<string> | undefined;
export function timingSafeDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  return dummyHash;
}

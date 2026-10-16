import type { Actor } from './audit.js';
import type { AuthContext } from '../modules/auth/sessions.js';

export const actorOf = (auth: AuthContext): Actor => ({
  organizationId: auth.organizationId,
  unitId: auth.unitId,
  userId: auth.userId,
});

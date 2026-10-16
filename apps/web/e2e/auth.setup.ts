import { test as setup } from '@playwright/test';
import { ADMIN_STATE, loginAsAdmin } from './helpers';

// Uma sessão de administrador compartilhada pelos testes de módulo: o login tem limite de
// tentativas por minuto, e cada teste entrando de novo esgotaria esse limite.
setup('sessão do administrador', async ({ page }) => {
  await loginAsAdmin(page);
  await page.context().storageState({ path: ADMIN_STATE });
});

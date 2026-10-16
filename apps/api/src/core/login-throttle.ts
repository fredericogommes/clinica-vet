/**
 * Limite de falhas de login por e-mail, complementar ao limite por IP da rota: impede que
 * tentativas distribuídas em muitos IPs adivinhem a senha de uma conta. Conta também e-mails
 * inexistentes, para não revelar quais contas existem. Estado em memória: a API roda em uma
 * instância; com várias, o limite vale por instância.
 */
export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 15 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  isBlocked(email: string): boolean {
    return this.recent(email).length >= this.maxFailures;
  }

  recordFailure(email: string): void {
    const list = this.recent(email);
    list.push(this.now());
    this.failures.set(email, list);
    if (this.failures.size > 10_000) this.prune();
  }

  reset(email: string): void {
    this.failures.delete(email);
  }

  private recent(email: string): number[] {
    const cutoff = this.now() - this.windowMs;
    return (this.failures.get(email) ?? []).filter((t) => t > cutoff);
  }

  private prune(): void {
    for (const email of this.failures.keys()) {
      const list = this.recent(email);
      if (list.length === 0) this.failures.delete(email);
      else this.failures.set(email, list);
    }
  }
}

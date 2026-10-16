import { describe, expect, it } from 'vitest';
import { LoginThrottle } from './login-throttle.js';

describe('LoginThrottle', () => {
  it('bloqueia na quinta falha dentro da janela e libera depois dela', () => {
    let now = 0;
    const throttle = new LoginThrottle(5, 1000, () => now);
    for (let i = 0; i < 4; i++) throttle.recordFailure('a@x');
    expect(throttle.isBlocked('a@x')).toBe(false);
    throttle.recordFailure('a@x');
    expect(throttle.isBlocked('a@x')).toBe(true);
    expect(throttle.isBlocked('b@x')).toBe(false);
    now = 1001;
    expect(throttle.isBlocked('a@x')).toBe(false);
  });

  it('login com sucesso zera as falhas', () => {
    const throttle = new LoginThrottle(2, 1000, () => 0);
    throttle.recordFailure('a@x');
    throttle.reset('a@x');
    throttle.recordFailure('a@x');
    expect(throttle.isBlocked('a@x')).toBe(false);
  });
});

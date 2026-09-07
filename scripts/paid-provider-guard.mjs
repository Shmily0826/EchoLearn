const ALLOW_ENV = 'ECHOLEARN_ALLOW_PAID_PROVIDER';
const CAP_ENV = 'ECHOLEARN_PAID_MAX_INVOCATIONS';

export class PaidProviderGuardError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PaidProviderGuardError';
    this.code = code;
  }
}

/**
 * Resolve the per-process paid-provider policy. Unset means deliberately
 * disabled; every partial or non-exact configuration is invalid.
 */
export function resolvePaidProviderPolicy(env = process.env) {
  const optIn = env[ALLOW_ENV];
  const cap = env[CAP_ENV];

  if (optIn === undefined && cap === undefined) {
    return { enabled: false, maxInvocations: 0 };
  }
  if (optIn !== '1') {
    throw new PaidProviderGuardError(
      'invalid_configuration',
      `${ALLOW_ENV} must be exactly "1" when paid-provider configuration is present`,
    );
  }
  if (cap === undefined || !/^(0|[1-9]\d*)$/.test(cap)) {
    throw new PaidProviderGuardError(
      'invalid_configuration',
      `${CAP_ENV} must be a non-negative integer when ${ALLOW_ENV}=1`,
    );
  }
  const maxInvocations = Number(cap);
  if (!Number.isSafeInteger(maxInvocations)) {
    throw new PaidProviderGuardError(
      'invalid_configuration',
      `${CAP_ENV} must be a safe integer`,
    );
  }
  return { enabled: true, maxInvocations };
}

export function createPaidProviderGuard(policy) {
  if (!policy || typeof policy.enabled !== 'boolean' || !Number.isSafeInteger(policy.maxInvocations) || policy.maxInvocations < 0 || (!policy.enabled && policy.maxInvocations !== 0)) {
    throw new PaidProviderGuardError('invalid_configuration', 'paid-provider policy is malformed');
  }

  let invocations = 0;
  return {
    enabled: policy.enabled,
    maxInvocations: policy.maxInvocations,
    get invocations() {
      return invocations;
    },
    async invoke(fetchImpl, ...args) {
      if (!policy.enabled) {
        throw new PaidProviderGuardError(
          'blocked',
          'paid provider blocked: explicit opt-in and max-invocations cap are required',
        );
      }
      if (invocations >= policy.maxInvocations) {
        throw new PaidProviderGuardError(
          'cap_exceeded',
          `paid provider invocation cap exceeded (${policy.maxInvocations})`,
        );
      }
      invocations += 1;
      return fetchImpl(...args);
    },
  };
}

export async function invokePaidProvider(guard, fetchImpl, ...args) {
  if (!guard || typeof guard.invoke !== 'function') {
    throw new PaidProviderGuardError('blocked', 'paid provider blocked: guard is missing');
  }
  return guard.invoke(fetchImpl, ...args);
}

export { ALLOW_ENV, CAP_ENV };

type BudgetState = {
  day: string;
  attempts: number;
  active: number;
};

const state: BudgetState = {
  day: new Date().toISOString().slice(0, 10),
  attempts: 0,
  active: 0,
};

/**
 * Single-instance safety valve. Production must additionally configure a hard
 * budget at the provider and an account-level quota in the application.
 */
export function reserveMistralRequest(now = new Date()): () => void {
  const day = now.toISOString().slice(0, 10);
  if (state.day !== day) {
    state.day = day;
    state.attempts = 0;
  }

  const dailyLimit = readBoundedInteger(
    process.env.MISTRAL_DAILY_CALL_LIMIT ??
      process.env.MISTRAL_DAILY_REQUEST_LIMIT,
    1_000,
    1,
    100_000,
  );
  const concurrencyLimit = readBoundedInteger(
    process.env.MISTRAL_MAX_CONCURRENT_REQUESTS,
    2,
    1,
    20,
  );
  if (state.attempts >= dailyLimit) {
    throw new Error(
      "Le budget quotidien du fournisseur d'analyse est atteint.",
    );
  }
  if (state.active >= concurrencyLimit) {
    throw new Error(
      "Le fournisseur d'analyse traite deja le nombre maximal de requetes.",
    );
  }

  state.attempts += 1;
  state.active += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.active = Math.max(0, state.active - 1);
  };
}

function readBoundedInteger(
  configuredValue: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(configuredValue);
  return Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

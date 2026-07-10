export type Currency = "EUR";

export type Money = Readonly<{
  cents: number;
  currency: Currency;
}>;

export function euro(cents: number): Money {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error("Money amount must be a positive integer in cents.");
  }

  return { cents, currency: "EUR" };
}


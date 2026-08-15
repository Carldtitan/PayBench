export function assertEngineServerOnly(): void {
  if (typeof window !== "undefined") {
    throw new Error("PayBench engine adapters can run only on the server.");
  }
}

assertEngineServerOnly();


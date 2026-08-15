export function assertServerOnly(): void {
  if (typeof window !== "undefined") {
    throw new Error("Sponsor status adapters can run only on the server.");
  }
}

assertServerOnly();

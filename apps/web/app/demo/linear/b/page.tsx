import type { Metadata } from "next";

import { LinearPaywallDemo } from "../../../../components/linear-paywall-demo";

export const metadata: Metadata = {
  title: "Linear plan simulation · B",
  description: "PayBench simulated Linear checkout trust-emphasis challenger",
};

export default function LinearChallengerPage() {
  return <LinearPaywallDemo variant="b" />;
}

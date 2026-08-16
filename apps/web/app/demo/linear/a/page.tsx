import type { Metadata } from "next";

import { LinearPaywallDemo } from "../../../../components/linear-paywall-demo";

export const metadata: Metadata = {
  title: "Linear plan simulation · A",
  description: "PayBench simulated Linear checkout control",
};

export default function LinearControlPage() {
  return <LinearPaywallDemo variant="a" />;
}

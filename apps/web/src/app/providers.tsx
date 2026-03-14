"use client";
import { PrivyProvider } from "@privy-io/react-auth";
import { celo } from "viem/chains";
import { defineChain } from "viem";

// FIX 1: Celo Sepolia (11142220) is the project testnet — not Alfajores (44787).
//         Alfajores is a legacy testnet where our contracts are not deployed.
// FIX 2: NEXT_PUBLIC_APP_ENV is "prod" not "production" — must match backend APP_ENV.
//         Using "production" meant isMainnet was always false, so even prod users
//         got pointed to the wrong testnet chain.
const celoSepolia = defineChain({
  id: 11142220,
  name: "Celo Sepolia",
  nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
  rpcUrls: { default: { http: ["https://forno.celo-sepolia.celo.org"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://celo-sepolia.blockscout.com" } },
  testnet: true,
});

export function Providers({ children }: { children: React.ReactNode }) {
  const appId     = process.env.NEXT_PUBLIC_PRIVY_APP_ID!;
  const isMainnet = process.env.NEXT_PUBLIC_APP_ENV === "prod"; // FIX: was "production"

  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme:                "light",
          accentColor:          "#059669",
          logo:                 "/logo.png",
          showWalletLoginFirst: false,
          walletChainType:      "ethereum-only",
        },
        loginMethods:    ["email", "google", "wallet"],
        defaultChain:    isMainnet ? celo : celoSepolia,    // FIX: was celoAlfajores
        supportedChains: [celo, celoSepolia],               // FIX: was celoAlfajores
        embeddedWallets: {
          createOnLogin:               "users-without-wallets",
          requireUserPasswordOnCreate: false,
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}

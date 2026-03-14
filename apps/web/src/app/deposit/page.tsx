"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// /deposit now redirects to /enable (terminology: "Deposit" → "Enable Piggy")
export default function DepositLegacyRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/enable"); }, []);
  return null;
}

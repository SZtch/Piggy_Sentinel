"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Onboarding is handled by /enable
export default function OnboardingPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/enable"); }, []);
  return null;
}

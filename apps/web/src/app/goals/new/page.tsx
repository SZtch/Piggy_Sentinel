"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Goal creation is handled by /enable
export default function NewGoalPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/enable"); }, []);
  return null;
}

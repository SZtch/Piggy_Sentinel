import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const upstream = await fetch(`${API_URL}/api/chat`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });

    if (upstream.status === 402) {
      return NextResponse.json(
        { answer: "You've used your 10 free messages this month. Each additional message costs 0.01 USDm." },
        { status: 402 }
      );
    }

    const data = await upstream.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ answer: "Connection error — please try again." }, { status: 500 });
  }
}

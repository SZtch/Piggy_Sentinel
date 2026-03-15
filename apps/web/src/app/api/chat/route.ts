import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.PIGGY_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Forward x-payment header kalau ada (x402 flow)
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const xPayment = req.headers.get("x-payment");
    if (xPayment) headers["x-payment"] = xPayment;

    const upstream = await fetch(`${API_URL}/api/chat`, {
      method:  "POST",
      headers,
      body:    JSON.stringify(body),
    });

    // Forward 402 dengan full x402 info untuk PennyBubble
    if (upstream.status === 402) {
      const data = await upstream.json();
      return NextResponse.json(data, { status: 402 });
    }

    const data = await upstream.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { answer: "Connection error — please try again." },
      { status: 500 }
    );
  }
}

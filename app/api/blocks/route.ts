import { NextResponse } from "next/server";

const RPC_URL = "https://dream-rpc.somnia.network";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();

    return new NextResponse(text, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (error) {
    console.error("[api/blocks] error proxying request:", error);
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32000,
          message: "Internal server error proxying Somnia RPC",
        },
      },
      { status: 500 }
    );
  }
}


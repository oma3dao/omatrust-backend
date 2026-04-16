import { NextResponse } from "next/server";
import { clearSessionCookie, revokeCurrentSession } from "@/lib/services/session-service";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await revokeCurrentSession(request);
    const response = NextResponse.json({ success: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

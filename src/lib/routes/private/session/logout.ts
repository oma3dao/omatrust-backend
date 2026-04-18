import { NextResponse } from "next/server";
import { clearSessionCookie, revokeCurrentSession } from "@/lib/services/session-service";

export async function postSessionLogout(request: Request) {
  await revokeCurrentSession(request);

  const response = NextResponse.json({ success: true });
  clearSessionCookie(response);
  return response;
}

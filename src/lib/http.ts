import { NextResponse } from "next/server";
import { ApiError, toApiError } from "@/lib/errors";

export function json<T>(body: T, init?: ResponseInit) {
  return NextResponse.json(body, init);
}

export function ok<T>(body: T, init?: ResponseInit) {
  return json(body, init);
}

export function created<T>(body: T, init?: ResponseInit) {
  return json(body, { status: 201, ...init });
}

export function errorResponse(error: unknown) {
  const apiError = toApiError(error);

  return json(
    {
      error: apiError.message,
      code: apiError.code
    },
    {
      status: apiError.statusCode
    }
  );
}

export async function parseJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ApiError("Invalid JSON body", 400, "INVALID_JSON");
  }
}

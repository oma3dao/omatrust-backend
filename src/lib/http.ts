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

  const isServerError = apiError.statusCode >= 500;

  return json(
    {
      error: isServerError
        ? "Something went wrong on our end. Please report this issue using the link at the top of the page."
        : apiError.message,
      code: apiError.code,
      details: isServerError
        ? apiError.message
        : apiError.details
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

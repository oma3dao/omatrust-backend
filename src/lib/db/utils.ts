import { ApiError } from "@/lib/errors";

export function isNoRowsError(error: { code?: string; details?: string | null } | null): boolean {
  return !!error && error.code === "PGRST116";
}

export function assertSupabase<T>(
  data: T | null | undefined,
  error: { message?: string; code?: string } | null,
  fallbackMessage = "Database operation failed"
): NonNullable<T> {
  if (error) {
    throw new ApiError(error.message || fallbackMessage, 500, error.code || "DATABASE_ERROR");
  }

  if (data === null || data === undefined) {
    throw new ApiError(fallbackMessage, 500, "DATABASE_EMPTY");
  }

  return data as NonNullable<T>;
}

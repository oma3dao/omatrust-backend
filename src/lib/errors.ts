import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode = 500,
    public code = "INTERNAL_ERROR",
    public details?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function toApiError(error: unknown): ApiError {
  if (isApiError(error)) {
    return error;
  }

  if (error instanceof ZodError) {
    return new ApiError(error.issues[0]?.message ?? "Invalid input", 400, "INVALID_INPUT");
  }

  if (error instanceof Error) {
    return new ApiError(error.message, 500, "INTERNAL_ERROR");
  }

  return new ApiError("Internal error", 500, "INTERNAL_ERROR");
}

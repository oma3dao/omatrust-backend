import type { ZodTypeAny, infer as zInfer } from "zod";
import { errorResponse, ok, parseJson } from "@/lib/http";
import { toApiError } from "@/lib/errors";
import logger from "@/lib/logger";
import type { AccountContext } from "@/lib/services/account-service";
import { getAuthenticatedAccountContext } from "@/lib/services/session-service";

type AuthMode = "none" | "session";
type BodyMode = "none" | "json" | "text";

type RouteParams = Record<string, string>;

type InferSchema<TSchema extends ZodTypeAny | undefined> = TSchema extends ZodTypeAny ? zInfer<TSchema> : undefined;

export interface RouteHandlerContext<
  TBody = undefined,
  TQuery = undefined,
  TParams extends RouteParams | undefined = undefined
> {
  request: Request;
  body: TBody;
  query: TQuery;
  params: TParams;
  accountContext: AccountContext | null;
}

interface RouteOptions<
  TBodySchema extends ZodTypeAny | undefined = undefined,
  TQuerySchema extends ZodTypeAny | undefined = undefined,
  TParamsSchema extends ZodTypeAny | undefined = undefined
> {
  auth?: AuthMode;
  bodyMode?: BodyMode;
  bodySchema?: TBodySchema;
  querySchema?: TQuerySchema;
  paramsSchema?: TParamsSchema;
  debugName: string;
  handler: (
    context: RouteHandlerContext<
      InferSchema<TBodySchema>,
      InferSchema<TQuerySchema>,
      InferSchema<TParamsSchema>
    >
  ) => Promise<Response | unknown> | Response | unknown;
}

function searchParamsToObject(request: Request) {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

async function loadAccountContext(request: Request, auth: AuthMode) {
  if (auth === "session") {
    return getAuthenticatedAccountContext(request);
  }

  return null;
}

export function withRoute<
  TBodySchema extends ZodTypeAny | undefined = undefined,
  TQuerySchema extends ZodTypeAny | undefined = undefined,
  TParamsSchema extends ZodTypeAny | undefined = undefined
>(options: RouteOptions<TBodySchema, TQuerySchema, TParamsSchema>) {
  const auth = options.auth ?? "none";
  const bodyMode = options.bodyMode ?? (options.bodySchema ? "json" : "none");

  return async (
    request: Request,
    context: { params: Promise<RouteParams> }
  ): Promise<Response> => {
    const startedAt = Date.now();

    try {
      const rawParams = await context.params;
      const params = options.paramsSchema
        ? options.paramsSchema.parse(rawParams ?? {})
        : ((rawParams as InferSchema<TParamsSchema>) ?? undefined);
      const query = options.querySchema
        ? options.querySchema.parse(searchParamsToObject(request))
        : (undefined as InferSchema<TQuerySchema>);

      let body = undefined as InferSchema<TBodySchema>;
      if (bodyMode === "json") {
        const parsed = await parseJson<unknown>(request);
        body = options.bodySchema ? options.bodySchema.parse(parsed) : (parsed as InferSchema<TBodySchema>);
      } else if (bodyMode === "text") {
        const parsed = await request.text();
        body = options.bodySchema ? options.bodySchema.parse(parsed) : (parsed as InferSchema<TBodySchema>);
      }

      const accountContext = await loadAccountContext(request, auth);
      const result = await options.handler({
        request,
        body,
        query,
        params,
        accountContext
      });
      const response = result instanceof Response ? result : ok(result);

      logger.debug(`[route] ${options.debugName}`, {
        method: request.method,
        status: response.status,
        durationMs: Date.now() - startedAt
      });

      return response;
    } catch (error) {
      const apiError = toApiError(error);

      logger.error(`[route] ${options.debugName}`, {
        method: request.method,
        status: apiError.statusCode,
        code: apiError.code,
        durationMs: Date.now() - startedAt,
        error: apiError.message
      });

      return errorResponse(apiError);
    }
  };
}

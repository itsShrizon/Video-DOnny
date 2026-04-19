import { NextRequest, NextResponse } from "next/server";

// Wraps a route handler so any thrown error is returned as JSON with a real
// message instead of an empty 500 body (which surfaces in the client as the
// unhelpful "Unknown error").
export function withErrorHandler(
  handler: (req: NextRequest) => Promise<NextResponse>
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    try {
      return await handler(req);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      console.error(`[${req.nextUrl.pathname}]`, message, stack);
      return NextResponse.json(
        { error: message, where: req.nextUrl.pathname },
        { status: 500 }
      );
    }
  };
}

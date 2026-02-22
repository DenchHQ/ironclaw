/**
 * Shared test utilities for apps/web tests.
 * Provides mock Request builders, workspace root helpers, and common fixtures.
 */

/** Build a mock Request with JSON body. */
export function mockRequest(
  method: string,
  url: string,
  body?: unknown,
): Request {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost${url}`, init);
}

/** Build a GET Request with query params. */
export function mockGet(url: string, params?: Record<string, string>): Request {
  const u = new URL(`http://localhost${url}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      u.searchParams.set(k, v);
    }
  }
  return new Request(u.toString(), { method: "GET" });
}

/** Extract JSON body from a Response, asserting status. */
export async function jsonResponse<T = unknown>(
  res: Response,
  expectedStatus?: number,
): Promise<T> {
  if (expectedStatus !== undefined && res.status !== expectedStatus) {
    const text = await res.text().catch(() => "(unreadable)");
    throw new Error(
      `Expected status ${expectedStatus}, got ${res.status}: ${text}`,
    );
  }
  return res.json() as Promise<T>;
}

/** Build a mock Next.js route context with params. */
export function mockRouteContext(params: Record<string, string>) {
  return { params: Promise.resolve(params) };
}

import { resolveWorkspaceRoot } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/workspace/watch
 *
 * Server-Sent Events endpoint that watches the workspace for file changes.
 * Sends events: { type: "add"|"change"|"unlink"|"addDir"|"unlinkDir", path: string }
 * Falls back gracefully if chokidar is unavailable.
 */
export async function GET() {
  const root = resolveWorkspaceRoot();
  if (!root) {
    return new Response("Workspace not found", { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial heartbeat so the client knows the connection is alive
      controller.enqueue(encoder.encode("event: connected\ndata: {}\n\n"));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let watcher: any = null;
      let closed = false;

      // Debounce: batch rapid events into a single "refresh" signal
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      function sendEvent(type: string, filePath: string) {
        if (closed) {return;}
        if (debounceTimer) {clearTimeout(debounceTimer);}
        debounceTimer = setTimeout(() => {
          if (closed) {return;}
          try {
            const data = JSON.stringify({ type, path: filePath });
            controller.enqueue(encoder.encode(`event: change\ndata: ${data}\n\n`));
          } catch {
            // Stream may have been closed
          }
        }, 200);
      }

      // Keep-alive heartbeat every 30s to prevent proxy/timeout disconnects
      const heartbeat = setInterval(() => {
        if (closed) {return;}
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          // Ignore if closed
        }
      }, 30_000);

      try {
        // Dynamic import so the route still compiles if chokidar is missing
        const chokidar = await import("chokidar");
        watcher = chokidar.watch(root, {
          ignoreInitial: true,
          awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
          ignored: [
            /(^|[\\/])node_modules([\\/]|$)/,
            /\.duckdb\.wal$/,
            /\.duckdb\.tmp$/,
          ],
          depth: 10,
        });

        watcher.on("all", (eventType: string, filePath: string) => {
          // Make path relative to workspace root
          const rel = filePath.startsWith(root)
            ? filePath.slice(root.length + 1)
            : filePath;
          sendEvent(eventType, rel);
        });
      } catch {
        // chokidar not available, send a fallback event and close
        controller.enqueue(
          encoder.encode("event: error\ndata: {\"error\":\"File watching unavailable\"}\n\n"),
        );
      }

      // Cleanup when the client disconnects
      // The cancel callback is invoked by the runtime when the response is aborted
      const originalCancel = stream.cancel?.bind(stream);
      stream.cancel = async (reason) => {
        closed = true;
        clearInterval(heartbeat);
        if (debounceTimer) {clearTimeout(debounceTimer);}
        if (watcher) {await watcher.close();}
        if (originalCancel) {return originalCancel(reason);}
      };
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

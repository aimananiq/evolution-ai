import { createServer } from "node:http";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { redis } from "@evo/queue";
import { authoriseSocket } from "@/lib/socket-auth";

const port = Number(process.env.PORT ?? 3000);
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

await app.prepare();

const httpServer = createServer((req, res) => handle(req, res));

const pubClient = redis();
const subClient = pubClient.duplicate();

const io = new SocketIOServer(httpServer, {
  cors: { origin: false },
  adapter: createAdapter(pubClient, subClient),
});

io.use(async (socket, next) => {
  try {
    const auth = await authoriseSocket(socket.handshake.headers.cookie);
    if (!auth) return next(new Error("unauthorised"));
    (socket.data as any).userId = auth.userId;
    (socket.data as any).workspaceIds = auth.workspaceIds;
    next();
  } catch (err) {
    next(err as Error);
  }
});

io.on("connection", (socket) => {
  const data = socket.data as { userId: string; workspaceIds: string[] };
  for (const wsId of data.workspaceIds) {
    socket.join(`ws:${wsId}`);
  }

  socket.on("conv:join", async (conversationId: string) => {
    try {
      const { prisma } = await import("@evo/db");
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { workspaceId: true },
      });
      if (!conv) return;
      const allowed = (socket.data as any).workspaceIds as string[];
      if (!allowed.includes(conv.workspaceId)) return;
      socket.join(`ws:conv:${conversationId}`);
    } catch {
      // best-effort; deny on error
    }
  });
  socket.on("conv:leave", (conversationId: string) => {
    socket.leave(`ws:conv:${conversationId}`);
  });
});

subClient.psubscribe("events:*");
subClient.on("pmessage", (_pattern, channel, message) => {
  const workspaceId = channel.replace("events:", "");
  try {
    const payload = JSON.parse(message);
    io.to(`ws:${workspaceId}`).emit("event", payload);
    if (payload?.event?.kind === "message" && payload?.event?.conversationId) {
      io.to(`ws:conv:${payload.event.conversationId}`).emit("message", payload.event);
    }
  } catch {}
});

httpServer.listen(port, () => {
  console.log(`web listening on :${port}`);
});

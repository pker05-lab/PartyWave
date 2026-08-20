import { DurableObject } from "cloudflare:workers";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function partyId(code) {
  return envId(code);
}

function envId(code) {
  // Durable Object IDs are deterministic, so the same code maps to the same room.
  // The Worker only exposes the room through /ws/<code>.
  return code.toUpperCase();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "PartyWave", time: new Date().toISOString() });
    }

    if (url.pathname === "/api/create" && request.method === "POST") {
      const code = Array.from({ length: 8 }, () =>
        ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
      ).join("");
      return json({ code });
    }

    if (url.pathname.startsWith("/ws/")) {
      const code = url.pathname.split("/").pop()?.toUpperCase();
      if (!/^[A-Z2-9]{8}$/.test(code)) return new Response("Invalid party code", { status: 400 });

      const id = env.PARTY.idFromName(partyId(code));
      const room = env.PARTY.get(id);
      return room.fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};

export class PartyRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.sessions = new Map();
    this.hostId = null;
    this.partyState = {
      title: "Untitled Party",
      provider: "youtube",
      source: null,
      startedAt: null,
      playing: false,
      currentTime: 0
    };
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/ws") return new Response("Not found", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const id = crypto.randomUUID();

    server.accept();
    this.sessions.set(id, { ws: server, role: null });

    server.send(JSON.stringify({
      type: "welcome",
      id,
      hostId: this.hostId,
      state: this.partyState
    }));

    server.addEventListener("message", async event => {
      try {
        const msg = JSON.parse(event.data);
        await this.handleMessage(id, msg);
      } catch {
        server.send(JSON.stringify({ type: "error", message: "Invalid message." }));
      }
    });

    server.addEventListener("close", () => this.disconnect(id));
    server.addEventListener("error", () => this.disconnect(id));

    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(message, exceptId = null) {
    const payload = JSON.stringify(message);
    for (const [id, session] of this.sessions) {
      if (id !== exceptId) {
        try { session.ws.send(payload); } catch {}
      }
    }
  }

  send(id, message) {
    const s = this.sessions.get(id);
    if (s) {
      try { s.ws.send(JSON.stringify(message)); } catch {}
    }
  }

  async handleMessage(id, msg) {
    const session = this.sessions.get(id);
    if (!session) return;

    if (msg.type === "claim-host") {
      if (this.hostId && this.hostId !== id) {
        return this.send(id, { type: "error", message: "This party already has a host." });
      }
      this.hostId = id;
      session.role = "host";
      this.send(id, { type: "host-claimed", id });
      this.broadcast({ type: "host-changed", hostId: this.hostId });
      return;
    }

    if (msg.type === "set-name") {
      session.name = String(msg.name || "Guest").slice(0, 32);
      this.broadcast({
        type: "member",
        id,
        name: session.name,
        count: this.sessions.size
      });
      return;
    }

    if (msg.type === "state") {
      if (id !== this.hostId) return;
      this.partyState = {
        ...this.partyState,
        ...msg.state
      };
      this.broadcast({ type: "state", state: this.partyState }, id);
      return;
    }

    if (msg.type === "signal") {
      const target = msg.target;
      if (!target || !this.sessions.has(target)) return;
      this.send(target, {
        type: "signal",
        from: id,
        data: msg.data
      });
      return;
    }

    if (msg.type === "kick") {
      if (id !== this.hostId) return;
      const target = msg.target;
      const s = this.sessions.get(target);
      if (!s) return;
      this.send(target, { type: "kicked" });
      try { s.ws.close(4003, "Kicked by host"); } catch {}
      this.sessions.delete(target);
      return;
    }

    if (msg.type === "ping-room") {
      this.send(id, { type: "pong-room", t: Date.now() });
    }
  }

  disconnect(id) {
    const wasHost = id === this.hostId;
    this.sessions.delete(id);
    if (wasHost) {
      this.hostId = null;
      this.partyState.playing = false;
      this.broadcast({ type: "host-left" });
    }
    this.broadcast({ type: "count", count: this.sessions.size });
  }
}
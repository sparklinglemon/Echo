const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const { Innertube } = require("youtubei.js");

const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

//yt init
let yt;
(async () => {
  yt = await Innertube.create();
  console.log("YouTube API ready");
})();

//helpers
function extractVideoId(input) {
  input = input.trim();

  //raw id
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
    return input;
  }

  try {
    const url = new URL(input);

    // youtu.be/<id>
    if (url.hostname.includes("youtu.be")) {
      return url.pathname.slice(1);
    }

    // youtube.com/watch?v=<id>
    if (url.searchParams.has("v")) {
      return url.searchParams.get("v");
    }
  } catch {
    return null;
  }

  return null;
}

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith("/search")) {
    res.setHeader("Content-Type", "application/json");

    if (!yt) {
      res.writeHead(503);
      return res.end(JSON.stringify({ results: [] }));
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const q = url.searchParams.get("q");

    if (!q) {
      return res.end(JSON.stringify({ results: [] }));
    }

    try {
      //detect link
      const videoId = extractVideoId(q);

      if (videoId) {
        const info = await yt.getInfo(videoId);
        const video = info.basic_info;

        return res.end(
          JSON.stringify({
            results: [
              {
                videoId,
                title: video.title || "Unknown title",
                artist: video.author?.name || "Unknown artist",
                thumbnail: video.thumbnail?.[0]?.url || "",
                source: "youtube",
              },
            ],
          }),
        );
      }

      // normal search
      const search = await yt.search(q, { type: "video" });

      const results = (search.videos || []).slice(0, 15).map((v) => ({
        videoId: v.id,
        title: v.title?.text || "Unknown title",
        artist: v.author?.name || "Unknown artist",
        thumbnail: v.thumbnails?.[0]?.url || "",
        source: "youtube",
      }));

      return res.end(JSON.stringify({ results }));
    } catch (err) {
      console.error("Search error:", err);
      return res.end(JSON.stringify({ results: [] }));
    }
  }

  //static files
  const file = req.url === "/" ? "index.html" : req.url;
  const filePath = path.join(PUBLIC_DIR, file);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200);
    res.end(data);
  });
});

//websocket server
const wss = new WebSocket.Server({ server });
const rooms = {};

function broadcast(room, payload) {
  const data = JSON.stringify(payload);
  rooms[room]?.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

wss.on("connection", (ws) => {
  ws.room = null;
  ws.name = null;

  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());

    if (msg.type === "join") {
      ws.room = msg.room;
      ws.name = msg.name;

      if (!rooms[ws.room]) {
        rooms[ws.room] = {
          queue: [],
          current: null,
          clients: new Set(),
        };
      }

      rooms[ws.room].clients.add(ws);

      ws.send(
        JSON.stringify({
          type: "state",
          queue: rooms[ws.room].queue,
          current: rooms[ws.room].current,
        }),
      );
      return;
    }

    const room = rooms[ws.room];
    if (!room) return;

    if (msg.type === "queue_add") {
      if (!room.current) {
        room.current = {
          videoId: msg.item.videoId,
          startedAt: Date.now(),
          paused: false,
          pausedAt: null,
        };
      } else {
        room.queue.push(msg.item);
      }

      broadcast(ws.room, {
        type: "state",
        queue: room.queue,
        current: room.current,
      });
    }

    if (msg.type === "queue_next") {
      const next = room.queue.shift();
      room.current = next
        ? {
            videoId: next.videoId,
            startedAt: Date.now(),
            paused: false,
            pausedAt: null,
          }
        : null;

      broadcast(ws.room, {
        type: "state",
        queue: room.queue,
        current: room.current,
      });
    }

    if (msg.type === "seek" && room.current) {
      room.current.startedAt = Date.now() - msg.time * 1000;
      broadcast(ws.room, {
        type: "state",
        queue: room.queue,
        current: room.current,
      });
    }

    if (msg.type === "play" && room.current) {
      if (room.current.paused) {
        room.current.startedAt += Date.now() - room.current.pausedAt;
        room.current.paused = false;
        room.current.pausedAt = null;
      }
      broadcast(ws.room, { type: "play" });
    }

    if (msg.type === "pause" && room.current) {
      room.current.paused = true;
      room.current.pausedAt = Date.now();
      broadcast(ws.room, { type: "pause" });
    }
  });

  ws.on("close", () => {
    if (ws.room && rooms[ws.room]) {
      rooms[ws.room].clients.delete(ws);
      if (!rooms[ws.room].clients.size) {
        delete rooms[ws.room];
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});

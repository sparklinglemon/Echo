console.log("MAIN JS LOADED");

//room + user
const room = prompt("Room code:");
let name = localStorage.getItem("yt_name");
if (!name) {
  name = prompt("Enter your name:") || "Guest";
  localStorage.setItem("yt_name", name);
}

//html
document.body.innerHTML = `
<div style="display:flex;height:100vh;font-family:sans-serif;background:#0f0f0f;color:#eee">

  <!-- PLAYER -->
  <div style="flex:2;padding:24px;overflow-y:auto">
    <div style="display:flex;gap:20px;margin-bottom:16px">
      <img id="art"
           style="width:120px;height:120px;border-radius:12px;background:#222"/>

      <div>
        <div id="title"
             title="Open on YouTube"
             style="font-size:20px;font-weight:bold;cursor:pointer;text-decoration:underline">
          No song
        </div>
        <div id="artist" style="color:#aaa">—</div>
      </div>
    </div>

    <div id="player" style="width:0;height:0"></div>

    <input id="seek" type="range" min="0" max="100" value="0" style="width:100%"/>

    <div style="display:flex;justify-content:space-between;margin-top:8px;align-items:center">
      <div style="display:flex;gap:8px;align-items:center">
        <button id="prev">⏮</button>
        <button id="play">Play</button>
        <button id="next">⏭</button>

        <span style="margin-left:12px">🔊</span>
        <input id="volume" type="range" min="0" max="100" style="width:100px"/>
      </div>
      <div id="time">0:00 / 0:00</div>
    </div>

    <h4>Queue</h4>
    <div id="queue"></div>
  </div>

  <!-- SEARCH -->
  <div style="flex:1;padding:20px;border-left:1px solid #333;display:flex;flex-direction:column">
    <input id="search" placeholder="Search music" style="padding:8px"/>
    <button id="go" style="margin-top:6px">Search</button>

    <div id="results"
         style="margin-top:12px;overflow-y:auto;flex:1;padding-right:6px">
    </div>
  </div>

</div>
`;

//dom
const ws = new WebSocket(`ws://${location.host}`);
const queueEl = document.getElementById("queue");
const resultsEl = document.getElementById("results");
const seek = document.getElementById("seek");
const volume = document.getElementById("volume");
const playBtn = document.getElementById("play");
const nextBtn = document.getElementById("next");
const prevBtn = document.getElementById("prev");
const titleEl = document.getElementById("title");
const artistEl = document.getElementById("artist");
const artEl = document.getElementById("art");
const timeEl = document.getElementById("time");
const searchInput = document.getElementById("search");

//state
let player;
let playerReady = false;
let isPlaying = false;
let isSeeking = false;

let queue = [];
let current = null;

let loadedVideoId = null;
let lastServerSeek = 0;


let playbackUnlocked = false;
let suppressState = false;

//volume
const savedVolume = Number(localStorage.getItem("yt_volume") ?? 70);
volume.value = savedVolume;

/***********************************************************
 * WEBSOCKET
 ***********************************************************/
ws.onopen = () => ws.send(JSON.stringify({ type: "join", room, name }));

ws.onmessage = e => {
  const msg = JSON.parse(e.data);

  if (msg.type === "state") {
    queue = msg.queue || [];
    current = msg.current;
    renderQueue();
    syncFromServer();
  }

  if (msg.type === "pause") {
    suppressState = true;
    player?.pauseVideo();
  }

  if (msg.type === "play") {
    suppressState = true;
    tryPlay();
  }
};

/***********************************************************
 * YOUTUBE PLAYER
 ***********************************************************/
window.onYouTubeIframeAPIReady = () => {
  player = new YT.Player("player", {
    events: {
      onReady: () => {
        playerReady = true;
        player.setVolume(savedVolume);
        syncFromServer();
      },
      onStateChange: e => {
        if (e.data === YT.PlayerState.PLAYING) {
          isPlaying = true;

          // 🔑 THIS is the unlock
          playbackUnlocked = true;

          playBtn.textContent = "Pause";

          const d = player.getVideoData();
          titleEl.textContent = d?.title || "Unknown";
          artistEl.textContent = d?.author || "Unknown artist";
          artEl.src = `https://img.youtube.com/vi/${current?.videoId}/hqdefault.jpg`;

          suppressState = false;
        }

        if (e.data === YT.PlayerState.PAUSED) {
          isPlaying = false;
          playBtn.textContent = "Play";

          if (!suppressState) {
            ws.send(JSON.stringify({ type: "pause" }));
          }
          suppressState = false;
        }

        if (e.data === YT.PlayerState.ENDED) {
          ws.send(JSON.stringify({ type: "queue_next" }));
        }
      }
    }
  });
};

/***********************************************************
 * CONTROLS
 ***********************************************************/
titleEl.onclick = () => {
  if (!current?.videoId) return;
  window.open(`https://www.youtube.com/watch?v=${current.videoId}`, "_blank");
};

playBtn.onclick = () => {
  playbackUnlocked = true;
  ws.send(JSON.stringify({ type: isPlaying ? "pause" : "play" }));
};

nextBtn.onclick = () => ws.send(JSON.stringify({ type: "queue_next" }));
prevBtn.onclick = () => ws.send(JSON.stringify({ type: "seek", time: 0 }));

seek.onmousedown = () => (isSeeking = true);
seek.onmouseup = e => {
  isSeeking = false;
  ws.send(JSON.stringify({
    type: "seek",
    time: (player.getDuration() * e.target.value) / 100
  }));
};

volume.oninput = e => {
  const v = Number(e.target.value);
  player?.setVolume(v);
  localStorage.setItem("yt_volume", v);
};

/***********************************************************
 * SYNC FROM SERVER (OLD WORKING VERSION)
 ***********************************************************/
function syncFromServer() {
  if (!playerReady || !current) return;

  const elapsed = current.paused
    ? (current.pausedAt - current.startedAt) / 1000
    : (Date.now() - current.startedAt) / 1000;

  if (loadedVideoId !== current.videoId) {
    loadedVideoId = current.videoId;
    player.loadVideoById(current.videoId, elapsed);
  } else {
    lastServerSeek = Date.now();
    player.seekTo(elapsed, true);
  }

  suppressState = true;
  current.paused ? player.pauseVideo() : tryPlay();
}

/***********************************************************
 * SAFE PLAY (DO NOT BYPASS)
 ***********************************************************/
function tryPlay() {
  if (!playbackUnlocked) return;
  player.playVideo();
}

/***********************************************************
 * SEEK BAR UPDATE
 ***********************************************************/
setInterval(() => {
  if (!playerReady || !player.getDuration()) return;
  if (Date.now() - lastServerSeek < 400) return;

  const cur = player.getCurrentTime();
  const dur = player.getDuration();

  if (!isSeeking) seek.value = (cur / dur) * 100;
  timeEl.textContent = `${fmt(cur)} / ${fmt(dur)}`;
}, 250);

/***********************************************************
 * QUEUE UI
 ***********************************************************/
function renderQueue() {
  queueEl.innerHTML = "";
  queue.forEach(item => {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "12px";
    row.style.marginBottom = "12px";

    row.innerHTML = `
      <img src="${item.thumbnail}" style="width:48px;height:48px;border-radius:6px"/>
      <div>
        <div style="font-weight:600">${item.title}</div>
        <div style="font-size:13px;color:#aaa">
          ${item.artist}
          <span style="color:#777">(added by ${item.addedBy})</span>
        </div>
      </div>
    `;

    queueEl.appendChild(row);
  });
}

/***********************************************************
 * SEARCH
 ***********************************************************/
document.getElementById("go").onclick = runSearch;
searchInput.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    runSearch();
  }
});

async function runSearch() {
  const q = searchInput.value.trim();
  if (!q) return;

  resultsEl.innerHTML = "Searching…";

  try {
    const r = await fetch(`/search?q=${encodeURIComponent(q)}`);
    const { results } = await r.json();

    resultsEl.innerHTML = "";

    results.slice(0, 15).forEach(i => {
      const d = document.createElement("div");
      d.style.display = "flex";
      d.style.gap = "10px";
      d.style.marginBottom = "12px";

      d.innerHTML = `
          <!-- ALBUM ART -->
          <img
            src="${i.thumbnail}"
            width="56"
            height="56"
            title="Add to queue"
            style="cursor:pointer;border-radius:6px"
          />

          <div style="flex:1">
            <!-- TITLE -->
            <div
              title="Open on YouTube"
              style="
                font-weight:600;
                cursor:pointer;
                text-decoration:underline;
              "
              class="yt-title"
            >
              ${i.title}
            </div>

            <div style="font-size:12px;color:#aaa">
              ${i.artist}
            </div>
          </div>
        `;


      d.querySelector("img").onclick = () => {
        ws.send(JSON.stringify({
          type: "queue_add",
          item: { ...i, addedBy: name }
        }));
      };

      const title = d.querySelector(".yt-title");
      title.onclick = (e) => {
        e.stopPropagation();
        window.open(`https://www.youtube.com/watch?v=${i.videoId}`,"_blank");
      };

      resultsEl.appendChild(d);
    });
  } catch {
    resultsEl.innerHTML = "Search failed";
  }
}

/***********************************************************
 * UTILS
 ***********************************************************/
function fmt(s) {
  s = Math.floor(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}






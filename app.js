const SRT_PATH = "data/sei-complimenti.srt";
const EXPRESSIONS_PATH = "data/expressions.json";

const audio = document.getElementById("audio");
const playBtn = document.getElementById("playBtn");
const seek = document.getElementById("seek");
const currentTimeEl = document.getElementById("currentTime");
const durationEl = document.getElementById("duration");
const cueList = document.getElementById("cueList");
const expressionSection = document.querySelector(".expressions");
const expressionList = document.getElementById("expressionList");
const loopSegment = document.getElementById("loopSegment");
const stopAtEnd = document.getElementById("stopAtEnd");
const clearFocus = document.getElementById("clearFocus");
const iconPlay = playBtn.querySelector(".icon-play");
const iconPause = playBtn.querySelector(".icon-pause");

/** @type {{ id: number, start: number, end: number, text: string }[]} */
let cues = [];
/** @type {number | null} */
let focusIndex = null;
let seeking = false;

function parseTimestamp(value) {
  const [hms, ms] = value.trim().replace(",", ".").split(".");
  const [h, m, s] = hms.split(":").map(Number);
  const millis = Number((ms || "0").padEnd(3, "0").slice(0, 3));
  return h * 3600 + m * 60 + s + millis / 1000;
}

function parseSrt(raw) {
  return raw
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split("\n").filter(Boolean);
      if (lines.length < 2) return null;
      const timeLine = lines[0].includes("-->") ? lines[0] : lines[1];
      const textLines = lines[0].includes("-->") ? lines.slice(1) : lines.slice(2);
      const match = timeLine.match(
        /(\d{2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{1,3})/
      );
      if (!match) return null;
      return {
        start: parseTimestamp(match[1]),
        end: parseTimestamp(match[2]),
        text: textLines.join("\n").trim(),
      };
    })
    .filter(Boolean)
    .map((cue, index) => ({ ...cue, id: index + 1 }));
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function setPlayingUi(playing) {
  iconPlay.hidden = playing;
  iconPause.hidden = !playing;
  playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
}

function updateSeekUi() {
  if (!seeking && Number.isFinite(audio.duration) && audio.duration > 0) {
    seek.value = String(Math.round((audio.currentTime / audio.duration) * 1000));
  }
  currentTimeEl.textContent = formatTime(audio.currentTime);
}

function setFocus(index) {
  focusIndex = index;
  clearFocus.disabled = index === null;
  document.querySelectorAll(".cue").forEach((el, i) => {
    el.classList.toggle("is-focus", i === index);
  });
}

function activateCue(index, { play = true } = {}) {
  const cue = cues[index];
  if (!cue) return;
  setFocus(index);
  audio.currentTime = cue.start;
  updateSeekUi();
  highlightActive(index);
  if (play) {
    audio.play().catch(() => {});
  }
}

function highlightActive(index) {
  document.querySelectorAll(".cue").forEach((el, i) => {
    el.classList.toggle("is-active", i === index);
  });
}

function findCueAt(time) {
  return cues.findIndex((cue) => time >= cue.start && time < cue.end);
}

function renderCues() {
  cueList.innerHTML = "";
  cues.forEach((cue, index) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cue";
    btn.dataset.index = String(index);
    btn.innerHTML = `
      <div class="cue-meta">
        <span class="cue-index">${String(cue.id).padStart(2, "0")}</span>
        <span class="cue-time">${formatTime(cue.start)} – ${formatTime(cue.end)}</span>
      </div>
      <div class="cue-text"></div>
    `;
    btn.querySelector(".cue-text").textContent = cue.text;
    btn.addEventListener("click", () => activateCue(index));
    li.appendChild(btn);
    cueList.appendChild(li);
  });
}

/** @param {{ it: string, fr: string }[]} expressions */
function renderExpressions(expressions) {
  expressionList.innerHTML = "";
  expressions.forEach((item) => {
    const li = document.createElement("li");
    const it = document.createElement("span");
    it.lang = "it";
    it.textContent = item.it;
    const fr = document.createElement("span");
    fr.lang = "fr";
    fr.textContent = item.fr;
    li.append(it, fr);
    expressionList.appendChild(li);
  });
  expressionSection.hidden = expressions.length === 0;
}

playBtn.addEventListener("click", () => {
  if (audio.paused) {
    if (focusIndex !== null && audio.currentTime >= cues[focusIndex].end - 0.05) {
      audio.currentTime = cues[focusIndex].start;
    }
    audio.play().catch(() => {});
  } else {
    audio.pause();
  }
});

seek.addEventListener("pointerdown", () => {
  seeking = true;
});

seek.addEventListener("pointerup", () => {
  seeking = false;
});

seek.addEventListener("input", () => {
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
  audio.currentTime = (Number(seek.value) / 1000) * audio.duration;
  currentTimeEl.textContent = formatTime(audio.currentTime);
});

clearFocus.addEventListener("click", () => {
  setFocus(null);
});

audio.addEventListener("play", () => setPlayingUi(true));
audio.addEventListener("pause", () => setPlayingUi(false));
audio.addEventListener("ended", () => setPlayingUi(false));

audio.addEventListener("loadedmetadata", () => {
  durationEl.textContent = formatTime(audio.duration);
  updateSeekUi();
});

audio.addEventListener("timeupdate", () => {
  updateSeekUi();

  const active = findCueAt(audio.currentTime);
  if (active !== -1) highlightActive(active);
  else highlightActive(-1);

  if (focusIndex === null) return;
  const cue = cues[focusIndex];
  if (!cue) return;

  if (audio.currentTime >= cue.end - 0.04) {
    if (loopSegment.checked) {
      audio.currentTime = cue.start;
      return;
    }
    if (stopAtEnd.checked) {
      audio.pause();
      audio.currentTime = cue.end;
    }
  }
});

async function init() {
  const [srtResponse, expressionsResponse] = await Promise.all([
    fetch(SRT_PATH),
    fetch(EXPRESSIONS_PATH),
  ]);

  if (!srtResponse.ok) throw new Error(`Could not load transcript (${srtResponse.status})`);
  cues = parseSrt(await srtResponse.text());
  renderCues();

  if (expressionsResponse.ok) {
    renderExpressions(await expressionsResponse.json());
  } else {
    console.error(`Could not load expressions (${expressionsResponse.status})`);
  }
}

init().catch((error) => {
  cueList.innerHTML = `<li class="cue-text" style="padding:1rem">Could not load transcript.</li>`;
  console.error(error);
});

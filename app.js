const PLAYLIST_PATH = "data/playlist.json";

const audio = document.getElementById("audio");
const playBtn = document.getElementById("playBtn");
const seek = document.getElementById("seek");
const currentTimeEl = document.getElementById("currentTime");
const durationEl = document.getElementById("duration");
const cueList = document.getElementById("cueList");
const playlistPanel = document.getElementById("playlistPanel");
const playlistEl = document.getElementById("playlist");
const playlistCount = document.getElementById("playlistCount");
const playlistEmpty = document.getElementById("playlistEmpty");
const playlistToggle = document.getElementById("playlistToggle");
const playlistCollapsedSummary = document.getElementById("playlistCollapsedSummary");
const passageFilter = document.getElementById("passageFilter");
const passageTitle = document.getElementById("passageTitle");
const expressionSection = document.querySelector(".expressions");
const expressionList = document.getElementById("expressionList");
const loopSegment = document.getElementById("loopSegment");
const stopAtEnd = document.getElementById("stopAtEnd");
const playbackRate = document.getElementById("playbackRate");
const clearFocus = document.getElementById("clearFocus");
const iconPlay = playBtn.querySelector(".icon-play");
const iconPause = playBtn.querySelector(".icon-pause");
const SPEED_STORAGE_KEY = "italian-web-playback-rate";
const PLAYLIST_COLLAPSED_KEY = "italian-web-playlist-collapsed";

/** @typedef {{ id: string, title: string, tags?: string[], audio: string, transcript: string, expressions?: string, translations?: string }} Passage */

/** @type {Passage[]} */
let playlist = [];
/** @type {number} */
let currentPassageIndex = 0;
let passageFilterQuery = "";
/** @type {{ id: number, start: number, end: number, text: string, fr?: string }[]} */
let cues = [];
/** @type {number | null} */
let focusIndex = null;
/** @type {number} */
let lastActiveIndex = -1;
let seeking = false;
/** @type {number | null} */
let watchRaf = null;

function parseTimestamp(value) {
  const [hms, ms] = value.trim().replace(",", ".").split(".");
  const [h, m, s] = hms.split(":").map(Number);
  const millis = Number((ms || "0").padEnd(3, "0").slice(0, 3));
  return h * 3600 + m * 60 + s + millis / 1000;
}

function cleanCueText(raw) {
  const text = raw
    .replace(/<break\b[^>]*\/?>/gi, " ")
    .replace(/<break\b[^>]*/gi, " ")
    .replace(/\btime="[^"]*"\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (!text || /^(?:time=.*|\/?>)+$/i.test(text)) return "";
  return text;
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
      const text = cleanCueText(textLines.join("\n"));
      if (!text) return null;
      return {
        start: parseTimestamp(match[1]),
        end: parseTimestamp(match[2]),
        text,
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

function getCueButton(index) {
  return cueList.querySelector(`.cue[data-index="${index}"]`);
}

function setFocus(index) {
  focusIndex = index;
  clearFocus.disabled = index === null;
  document.querySelectorAll(".cue").forEach((el, i) => {
    el.classList.toggle("is-focus", i === index);
  });
}

function scrollCueIntoView(index) {
  const el = getCueButton(index);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
}

function highlightActive(index, { scroll = true } = {}) {
  document.querySelectorAll(".cue").forEach((el, i) => {
    el.classList.toggle("is-active", i === index);
  });
  if (index !== -1 && index !== lastActiveIndex && scroll) {
    scrollCueIntoView(index);
  }
  lastActiveIndex = index;
}

function findCueAt(time) {
  return cues.findIndex((cue) => time >= cue.start && time < cue.end);
}

function ensureFocusForSegmentControls() {
  if (focusIndex !== null) return focusIndex;
  const active = findCueAt(audio.currentTime);
  if (active === -1) return null;
  setFocus(active);
  return active;
}

function applySegmentBoundary() {
  if (!loopSegment.checked && !stopAtEnd.checked) return false;
  if (focusIndex === null) return false;

  const cue = cues[focusIndex];
  if (!cue) return false;
  if (audio.currentTime < cue.end - 0.03) return false;

  if (loopSegment.checked) {
    audio.currentTime = cue.start;
    highlightActive(focusIndex);
    return true;
  }

  if (stopAtEnd.checked) {
    audio.pause();
    audio.currentTime = Math.max(cue.start, cue.end - 0.05);
    highlightActive(focusIndex, { scroll: false });
    updateSeekUi();
    return true;
  }

  return false;
}

function syncPlaybackUi() {
  updateSeekUi();

  const active = findCueAt(audio.currentTime);
  if (active !== -1) highlightActive(active);
  else if (!audio.paused) highlightActive(-1);

  applySegmentBoundary();
}

function startWatch() {
  if (watchRaf !== null) return;
  const tick = () => {
    syncPlaybackUi();
    if (!audio.paused && !audio.ended) {
      watchRaf = requestAnimationFrame(tick);
    } else {
      watchRaf = null;
    }
  };
  watchRaf = requestAnimationFrame(tick);
}

function stopWatch() {
  if (watchRaf !== null) {
    cancelAnimationFrame(watchRaf);
    watchRaf = null;
  }
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
    if (cue.fr) {
      const fr = document.createElement("div");
      fr.className = "cue-fr";
      fr.lang = "fr";
      fr.textContent = cue.fr;
      btn.appendChild(fr);
    }
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

function normalizeSearch(value) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

function passageMatchesFilter(passage, query) {
  if (!query) return true;
  const haystack = normalizeSearch(
    [passage.title, passage.id, ...(passage.tags || [])].join(" ")
  );
  return query.split(/\s+/).every((token) => haystack.includes(token));
}

function getFilteredPassages() {
  const query = normalizeSearch(passageFilterQuery);
  return playlist
    .map((passage, index) => ({ passage, index }))
    .filter(({ passage }) => passageMatchesFilter(passage, query));
}

function renderPlaylist() {
  const filtered = getFilteredPassages();
  playlistEl.innerHTML = "";

  filtered.forEach(({ passage, index }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "playlist-item";
    btn.setAttribute("role", "option");
    btn.setAttribute("aria-selected", index === currentPassageIndex ? "true" : "false");
    btn.classList.toggle("is-current", index === currentPassageIndex);

    const title = document.createElement("span");
    title.className = "playlist-item-title";
    title.textContent = passage.title;
    btn.appendChild(title);

    if (passage.tags?.length) {
      const tags = document.createElement("div");
      tags.className = "playlist-item-tags";
      passage.tags.forEach((tag) => {
        const chip = document.createElement("span");
        chip.className = "playlist-tag";
        chip.textContent = tag;
        tags.appendChild(chip);
      });
      btn.appendChild(tags);
    }

    btn.addEventListener("click", () => {
      if (index !== currentPassageIndex) loadPassage(index);
    });
    playlistEl.appendChild(btn);
  });

  const total = playlist.length;
  const shown = filtered.length;
  playlistCount.textContent =
    passageFilterQuery.trim() && shown !== total ? `${shown} / ${total}` : `${total}`;
  playlistEmpty.hidden = shown > 0;
  playlistEl.hidden = shown === 0;
  updatePlaylistCollapsedSummary();
}

function updatePlaylistCollapsedSummary() {
  const current = playlist[currentPassageIndex];
  playlistCollapsedSummary.textContent = current ? current.title : "";
}

function setPlaylistCollapsed(collapsed) {
  playlistPanel.classList.toggle("is-collapsed", collapsed);
  playlistToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  playlistToggle.textContent = collapsed ? "Expand" : "Minimize";
  playlistCollapsedSummary.hidden = !collapsed;
  updatePlaylistCollapsedSummary();
  try {
    localStorage.setItem(PLAYLIST_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function resetPlaybackState() {
  stopWatch();
  audio.pause();
  setPlayingUi(false);
  setFocus(null);
  lastActiveIndex = -1;
  seek.value = "0";
  currentTimeEl.textContent = "0:00";
  durationEl.textContent = "0:00";
}

async function loadPassage(index, { autoplay = false } = {}) {
  const passage = playlist[index];
  if (!passage) return;

  currentPassageIndex = index;
  resetPlaybackState();
  renderPlaylist();
  passageTitle.textContent = passage.title;
  document.title = `Italian Web — ${passage.title}`;
  cueList.innerHTML = `<li class="cue-text" style="padding:1rem">Loading…</li>`;
  expressionSection.hidden = true;
  expressionList.innerHTML = "";

  const [transcriptResponse, expressionsResponse, translationsResponse] = await Promise.all([
    fetch(passage.transcript),
    passage.expressions ? fetch(passage.expressions) : Promise.resolve(null),
    passage.translations ? fetch(passage.translations) : Promise.resolve(null),
  ]);

  if (!transcriptResponse.ok) {
    throw new Error(`Could not load transcript (${transcriptResponse.status})`);
  }

  cues = parseSrt(await transcriptResponse.text());

  if (translationsResponse?.ok) {
    /** @type {string[]} */
    const translations = await translationsResponse.json();
    cues = cues.map((cue, index) => ({
      ...cue,
      fr: typeof translations[index] === "string" ? translations[index] : undefined,
    }));
  }

  renderCues();

  if (expressionsResponse?.ok) {
    renderExpressions(await expressionsResponse.json());
  } else {
    renderExpressions([]);
  }

  audio.src = passage.audio;
  audio.load();
  const activeSpeed = playbackRate.querySelector('.speed-btn[aria-pressed="true"]');
  audio.playbackRate = Number(activeSpeed?.dataset.rate) || 1;

  if (autoplay) {
    audio.play().catch(() => {});
  }

  try {
    history.replaceState(null, "", `#${passage.id}`);
  } catch {
    /* ignore */
  }
}

function passageIndexFromHash() {
  const id = location.hash.replace(/^#/, "");
  if (!id) return 0;
  const index = playlist.findIndex((passage) => passage.id === id);
  return index === -1 ? 0 : index;
}

function onSegmentOptionChange(changed) {
  if (changed.checked) ensureFocusForSegmentControls();
  applySegmentBoundary();
  syncPlaybackUi();
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
  syncPlaybackUi();
});

seek.addEventListener("pointercancel", () => {
  seeking = false;
});

seek.addEventListener("input", () => {
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
  audio.currentTime = (Number(seek.value) / 1000) * audio.duration;
  currentTimeEl.textContent = formatTime(audio.currentTime);
  const active = findCueAt(audio.currentTime);
  if (active !== -1) highlightActive(active);
});

clearFocus.addEventListener("click", () => {
  setFocus(null);
});

loopSegment.addEventListener("change", () => onSegmentOptionChange(loopSegment));
stopAtEnd.addEventListener("change", () => onSegmentOptionChange(stopAtEnd));

function applyPlaybackRate(rate) {
  const value = Number(rate);
  if (!Number.isFinite(value) || value <= 0) return;
  audio.playbackRate = value;
  playbackRate.querySelectorAll(".speed-btn").forEach((btn) => {
    const active = Number(btn.dataset.rate) === value;
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
  try {
    localStorage.setItem(SPEED_STORAGE_KEY, String(value));
  } catch {
    /* ignore */
  }
}

playbackRate.addEventListener("click", (event) => {
  const btn = event.target.closest(".speed-btn");
  if (!btn || !playbackRate.contains(btn)) return;
  applyPlaybackRate(btn.dataset.rate);
});

audio.addEventListener("play", () => {
  setPlayingUi(true);
  startWatch();
});
audio.addEventListener("pause", () => {
  setPlayingUi(false);
  stopWatch();
  syncPlaybackUi();
});
audio.addEventListener("ended", () => {
  setPlayingUi(false);
  stopWatch();
  syncPlaybackUi();
});

audio.addEventListener("loadedmetadata", () => {
  durationEl.textContent = formatTime(audio.duration);
  updateSeekUi();
});

audio.addEventListener("timeupdate", () => {
  syncPlaybackUi();
});

window.addEventListener("hashchange", () => {
  const index = passageIndexFromHash();
  if (index !== currentPassageIndex) {
    loadPassage(index).catch(console.error);
  }
});

passageFilter.addEventListener("input", () => {
  passageFilterQuery = passageFilter.value;
  renderPlaylist();
});

playlistToggle.addEventListener("click", () => {
  setPlaylistCollapsed(!playlistPanel.classList.contains("is-collapsed"));
});

async function init() {
  const response = await fetch(PLAYLIST_PATH);
  if (!response.ok) throw new Error(`Could not load playlist (${response.status})`);
  playlist = await response.json();
  if (!Array.isArray(playlist) || playlist.length === 0) {
    throw new Error("Playlist is empty");
  }

  const allowedRates = [...playbackRate.querySelectorAll(".speed-btn")].map(
    (btn) => btn.dataset.rate
  );
  let savedRate = "1";
  let savedCollapsed = false;
  try {
    savedRate = localStorage.getItem(SPEED_STORAGE_KEY) || "1";
    savedCollapsed = localStorage.getItem(PLAYLIST_COLLAPSED_KEY) === "1";
  } catch {
    /* ignore */
  }
  if (!allowedRates.includes(savedRate)) savedRate = "1";
  applyPlaybackRate(savedRate);
  setPlaylistCollapsed(savedCollapsed);

  await loadPassage(passageIndexFromHash());
}

init().catch((error) => {
  passageTitle.textContent = "Could not load playlist";
  cueList.innerHTML = `<li class="cue-text" style="padding:1rem">Could not load passages.</li>`;
  console.error(error);
});

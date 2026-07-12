// player.js — WebTorrent streaming player
// Reads ?magnet=, ?title=, ?poster= from URL and streams via WebTorrent.js
// Loaded by player.html which embeds webtorrent.min.js from CDN.

const params = new URLSearchParams(location.search);
const MAGNET = params.get('magnet') || '';
const TITLE  = params.get('title')  || 'Loading…';
const POSTER = params.get('poster') || '';

// Dead swarm warning fires after this many ms with 0 peers
const DEAD_SWARM_TIMEOUT = 90000;

const els = {};
let client     = null;
let torrent    = null;
let deadTimer  = null;
let statsTimer = null;

// ── Trackers ─────────────────────────────────────────────────────────────────
// Must stay in sync with worker.js WSS_TRACKERS and movie.html TRACKERS.
// These are ALL known public WebSocket trackers as of 2025.
// The player re-patches the magnet on arrival as a safety net in case
// the magnet came from an older code path without all 5 trackers.
const WSS_TRACKERS = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev',
  'wss://tracker.files.fm:7073/announce',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.fastcast.nz',
];

function patchMagnet(magnet) {
  if (!magnet) return magnet;
  const base     = magnet.split('&tr=')[0];
  const trackers = WSS_TRACKERS.map(t => `&tr=${encodeURIComponent(t)}`).join('');
  return base + trackers;
}

// ── Element cache ─────────────────────────────────────────────────────────────

function cacheElements() {
  els.playerTitle = document.getElementById('playerTitle');
  els.playerMeta  = document.getElementById('playerMeta');
  els.videoWrap   = document.getElementById('videoWrap');
  els.video       = document.getElementById('video');
  els.posterImg   = document.getElementById('posterImg');
  els.statsBar    = document.getElementById('statsBar');
  els.peers       = document.getElementById('statPeers');
  els.speed       = document.getElementById('statSpeed');
  els.progress    = document.getElementById('statProgress');
  els.warning     = document.getElementById('deadWarning');
  els.toast       = document.getElementById('toast');
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  cacheElements();

  els.playerTitle.textContent = TITLE;
  document.title = `${TITLE} — DigiFlix`;

  if (POSTER) {
    els.posterImg.src           = POSTER;
    els.posterImg.style.display = 'block';
  }

  if (!MAGNET) {
    showError('No magnet link provided. Go back and select a title.');
    return;
  }

  if (typeof WebTorrent === 'undefined') {
    showError('WebTorrent failed to load. Check your connection and refresh.');
    return;
  }

  startStream();
  bindKeyboardShortcuts();
}

// ── Streaming ─────────────────────────────────────────────────────────────────

function startStream() {
  els.playerMeta.textContent = 'Connecting to DHT swarm…';

  // dht:true  — use WebRTC DHT for broader peer discovery beyond tracker announcements
  // tracker:true — use WSS trackers embedded in the magnet
  // lsd:false — local service discovery is useless on the public internet
  client = new WebTorrent({ dht: true, tracker: true, lsd: false });

  client.on('error', (err) => {
    console.error('WebTorrent error:', err);
    showError('Stream error: ' + (err.message || err));
  });

  // Re-patch the magnet to ensure all 5 trackers are present regardless of source
  const magnet = patchMagnet(MAGNET);

  // sequential: prioritise pieces at the start of the file so playback
  // can begin before the full file is downloaded
  torrent = client.add(magnet, { strategy: 'sequential' }, onTorrentReady);

  // Dead swarm: warn after 90s if still 0 peers
  deadTimer = setTimeout(() => {
    if (torrent && torrent.numPeers === 0) {
      els.warning.style.display = 'block';
    }
  }, DEAD_SWARM_TIMEOUT);
}

function onTorrentReady(t) {
  torrent = t;

  // Pick the largest video file (the actual movie/episode, not a sample)
  const file = t.files
    .filter(f => /\.(mp4|mkv|avi|mov|webm|m4v|ogv)$/i.test(f.name))
    .sort((a, b) => b.length - a.length)[0];

  if (!file) {
    showError('No playable video file found in this torrent.');
    return;
  }

  // MKV warning — most browsers can't decode MKV natively
  if (/\.mkv$/i.test(file.name)) {
    showToast('MKV format — may not play in all browsers. Try 720p if it stalls.');
  }

  els.posterImg.style.display = 'none';
  els.videoWrap.style.display = 'block';
  els.statsBar.style.display  = 'flex';

  // renderTo() uses the MediaSource API — true progressive streaming.
  // Playback starts as soon as the first chunks arrive; no full download needed.
  file.renderTo(els.video, { autoplay: true }, (err) => {
    if (err) showError('Could not render video: ' + (err.message || err));
  });

  if (POSTER) els.video.poster = POSTER;

  // Live stats — update every second
  statsTimer = setInterval(() => {
    if (!torrent) return;

    const peers    = torrent.numPeers;
    const speed    = torrent.downloadSpeed;
    const progress = torrent.progress;

    els.peers.textContent    = peers;
    els.speed.textContent    = formatSpeed(speed);
    els.progress.textContent = (progress * 100).toFixed(1) + '%';

    // Once we have peers the swarm is alive — clear warning and timer
    if (peers > 0) {
      clearTimeout(deadTimer);
      els.warning.style.display  = 'none';
      els.playerMeta.textContent = `Streaming · ${peers} peer${peers !== 1 ? 's' : ''}`;
    }
  }, 1000);

  torrent.on('done', () => {
    clearInterval(statsTimer);
    els.playerMeta.textContent = 'Fully buffered ✓';
    els.progress.textContent   = '100%';
    els.speed.textContent      = '—';
  });
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

function bindKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (!els.video) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.key) {
      case ' ':
      case 'k':
        e.preventDefault();
        els.video.paused ? els.video.play() : els.video.pause();
        break;
      case 'f':
      case 'F':
        e.preventDefault();
        if (document.fullscreenElement) document.exitFullscreen();
        else els.videoWrap.requestFullscreen?.();
        break;
      case 'ArrowRight':
        els.video.currentTime += 10;
        showToast('+10s');
        break;
      case 'ArrowLeft':
        els.video.currentTime -= 10;
        showToast('−10s');
        break;
      case 'ArrowUp':
        e.preventDefault();
        els.video.volume = Math.min(1, els.video.volume + 0.1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        els.video.volume = Math.max(0, els.video.volume - 0.1);
        break;
      case 'm':
      case 'M':
        els.video.muted = !els.video.muted;
        showToast(els.video.muted ? 'Muted' : 'Unmuted');
        break;
    }
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function showError(msg) {
  els.playerMeta.textContent = msg;
  clearInterval(statsTimer);
  clearTimeout(deadTimer);
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(els.toast._timer);
  els.toast._timer = setTimeout(() => els.toast.classList.remove('show'), 1800);
}

function formatSpeed(bytesPerSec) {
  if (bytesPerSec < 1024)        return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / 1024 / 1024).toFixed(2)} MB/s`;
}

// ── Retry ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  init();

  document.getElementById('retryBtn')?.addEventListener('click', () => {
    els.warning.style.display = 'none';
    clearInterval(statsTimer);
    clearTimeout(deadTimer);
    if (client) { client.destroy(); client = null; torrent = null; }
    startStream();
  });
});
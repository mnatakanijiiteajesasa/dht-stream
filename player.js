// player.js — WebTorrent streaming player
// Reads ?magnet=, ?title=, ?poster= from URL and streams via WebTorrent.js
// Loaded by player.html which embeds webtorrent.min.js from CDN.

const WORKER = 'https://fancy-bar-b4d2.mogakanewton0.workers.dev';

const params  = new URLSearchParams(location.search);
const MAGNET  = params.get('magnet') || '';
const TITLE   = params.get('title')  || 'Loading…';
const POSTER  = params.get('poster') || '';

// Timeout before showing dead-swarm warning (ms)
const DEAD_SWARM_TIMEOUT = 90000;

const els = {};
let client     = null;
let torrent    = null;
let deadTimer  = null;
let statsTimer = null;

// ── Init ──────────────────────────────────────────────────────────────────────

function cacheElements() {
  els.playerTitle   = document.getElementById('playerTitle');
  els.playerMeta    = document.getElementById('playerMeta');
  els.videoWrap     = document.getElementById('videoWrap');
  els.video         = document.getElementById('video');
  els.posterImg     = document.getElementById('posterImg');
  els.statsBar      = document.getElementById('statsBar');
  els.peers         = document.getElementById('statPeers');
  els.speed         = document.getElementById('statSpeed');
  els.progress      = document.getElementById('statProgress');
  els.warning       = document.getElementById('deadWarning');
  els.toast         = document.getElementById('toast');
}

function init() {
  cacheElements();

  els.playerTitle.textContent = TITLE;
  document.title = `${TITLE} — DigiFlix`;

  if (POSTER) {
    els.posterImg.src = POSTER;
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

  client  = new WebTorrent();
  torrent = client.add(MAGNET, { strategy: 'sequential' }, onTorrentReady);

  client.on('error', (err) => {
    console.error('WebTorrent error:', err);
    showError('Stream error: ' + (err.message || err));
  });

  // Dead swarm warning after 90 seconds with 0 peers
  deadTimer = setTimeout(() => {
    if (torrent && torrent.numPeers === 0) {
      els.warning.style.display = 'block';
    }
  }, DEAD_SWARM_TIMEOUT);
}

function onTorrentReady(torrent) {
  // Pick the largest video file (the actual movie/episode)
  const file = torrent.files
    .filter((f) => /\.(mp4|mkv|avi|mov|webm)$/i.test(f.name))
    .sort((a, b) => b.length - a.length)[0];

  if (!file) {
    showError('No playable video file found in this torrent.');
    return;
  }

  // MKV warning — browsers can't play MKV natively
  if (/\.mkv$/i.test(file.name)) {
    showToast('Note: MKV format may not play in all browsers. Try 720p if it stalls.');
  }

  els.posterImg.style.display = 'none';
  els.videoWrap.style.display = 'block';
  els.statsBar.style.display  = 'flex';

  // renderTo uses MediaSource API — progressive streaming, no full download needed
  file.renderTo(els.video, { autoplay: true }, (err) => {
    if (err) showError('Could not render video: ' + (err.message || err));
  });

  els.video.poster = POSTER || '';

  // Live stats ticker
  statsTimer = setInterval(() => {
    if (!torrent) return;
    els.peers.textContent    = torrent.numPeers;
    els.speed.textContent    = formatSpeed(torrent.downloadSpeed);
    els.progress.textContent = (torrent.progress * 100).toFixed(1) + '%';

    // Hide dead-swarm warning once we get peers
    if (torrent.numPeers > 0) {
      clearTimeout(deadTimer);
      els.warning.style.display = 'none';
    }
  }, 1000);

  torrent.on('done', () => {
    clearInterval(statsTimer);
    els.playerMeta.textContent = 'Fully buffered';
  });
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

function bindKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (!els.video) return;
    // Don't hijack shortcuts when typing in an input
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
        showToast('-10s');
        break;
      case 'ArrowUp':
        els.video.volume = Math.min(1, els.video.volume + 0.1);
        break;
      case 'ArrowDown':
        els.video.volume = Math.max(0, els.video.volume - 0.1);
        break;
      case 'm':
      case 'M':
        els.video.muted = !els.video.muted;
        break;
    }
  });
}

// ── UI helpers ────────────────────────────────────────────────────────────────

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

// ── Retry button ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  init();

  const retryBtn = document.getElementById('retryBtn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      els.warning.style.display = 'none';
      if (client) { client.destroy(); client = null; }
      clearInterval(statsTimer);
      startStream();
    });
  }
});
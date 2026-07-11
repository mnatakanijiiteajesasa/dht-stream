// Configuration
const WORKER   = 'https://fancy-bar-b4d2.mogakanewton0.workers.dev';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w300';

// State — FIX: read ?tmdb_id= to match navigateToItem() in app.js
const state = {
  tmdbId:  new URLSearchParams(location.search).get('tmdb_id') || '',
  imdbId:  '',   // extracted from show's external_ids after /show fetch
  show:    null,
  season:  null,
  episodes: []
};

const els = {};

// ── API ───────────────────────────────────────────────────────────────────────

const api = {
  async request(path, params = {}) {
    const url = new URL(path, WORKER);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    });
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return response.json();
  },

  health() { return this.request('/health'); },

  // FIX: worker expects ?tmdb_id= not ?id=
  show(tmdbId) { return this.request('/show', { tmdb_id: tmdbId }); },

  // FIX: worker expects ?imdb_id=tt…&season=
  // imdbId must include the "tt" prefix (EZTV strips it server-side)
  episodes(imdbId, season) {
    return this.request('/episodes', { imdb_id: imdbId, season });
  },

  // worker expects ?tmdb_id=&season=&episode=
  episodeMeta(tmdbId, season, episode) {
    return this.request('/episode-meta', { tmdb_id: tmdbId, season, episode });
  }
};

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderEpisodeSkeletons(count = 8) {
  els.episodeGrid.innerHTML = Array.from({ length: count }, () => `
    <div class="skeleton-card">
      <div class="skeleton-poster"></div>
      <div class="skeleton-info">
        <div class="skeleton-line skeleton-line-wide"></div>
        <div class="skeleton-line skeleton-line-half"></div>
      </div>
    </div>
  `).join('');
}

function renderShow(show) {
  const title    = show.name    || show.title    || 'Untitled Show';
  const year     = getYear(show.first_air_date   || show.release_date || '');
  const rating   = show.vote_average || show.rating  || '';
  const overview = show.overview || show.description || 'No overview available.';

  // TMDB returns genres as objects: [{ id, name }]
  const genres = Array.isArray(show.genres)
    ? show.genres.map((g) => (typeof g === 'object' ? g.name : g)).join(', ')
    : '';

  // FIX: extract IMDB ID from external_ids appended by /show route
  // external_ids.imdb_id looks like "tt0903747"
  state.imdbId = show.external_ids?.imdb_id || '';

  // Update page title
  document.title = `${title} — DigiFlix`;

  els.showTitle.innerHTML   = `${escapeHtml(title)} <em>${year ? escapeHtml(year) : ''}</em>`;
  els.showMeta.textContent  = [year, genres].filter(Boolean).join(' / ') || 'TV Show';
  els.showRating.textContent = rating ? `★ ${formatRating(rating)}` : '';
  els.showOverview.innerHTML = `<p>${escapeHtml(overview)}</p>`;

  const seasons = normalizeSeasons(show);
  renderSeasons(seasons);
}

function renderSeasons(seasons) {
  if (!seasons.length) {
    els.seasonPills.innerHTML = '<button class="pill active" type="button" data-season="1">Season 1</button>';
    state.season = 1;
    loadEpisodes();
    return;
  }

  state.season = state.season || Number(seasons[0].season_number ?? seasons[0]);
  els.seasonPills.innerHTML = seasons.map((s) => {
    const number = Number(s.season_number ?? s);
    const label  = s.name || `Season ${number}`;
    return `<button class="pill ${number === state.season ? 'active' : ''}" type="button" data-season="${number}">${escapeHtml(label)}</button>`;
  }).join('');

  loadEpisodes();
}

function renderEpisodes(episodes) {
  els.episodeCount.textContent = episodes.length ? `${episodes.length} episodes` : '';
  els.episodeTitle.textContent = state.season ? `Season ${state.season} Episodes` : 'Episodes';

  if (!episodes.length) {
    els.episodeGrid.innerHTML = emptyState(
      'No episodes found',
      state.imdbId
        ? 'EZTV may not have torrents for this season yet.'
        : 'Could not find an IMDB ID for this show — EZTV lookup requires it.'
    );
    return;
  }

  els.episodeGrid.innerHTML = episodes.map((ep) => episodeCard(ep)).join('');
}

function episodeCard(ep) {
  const season  = ep.season  || state.season || 1;
  const number  = ep.episode || '';
  // Prefer TMDB-enriched title, fall back to EZTV filename-derived title
  const title   = ep.tmdb_title || ep.title || `Episode ${number}`;
  const airDate = ep.air_date || '';
  const rating  = ep.vote_average || '';
  const seeds   = ep.seeds ?? '';
  const magnet  = ep.magnet || '';

  // Prefer TMDB still image, fall back to EZTV screenshot
  const still   = ep.tmdb_still || ep.screenshot || '';

  return `
    <div class="card"
      data-magnet="${escapeAttribute(magnet)}"
      data-season="${escapeAttribute(String(season))}"
      data-episode="${escapeAttribute(String(number))}"
      data-tmdb-id="${escapeAttribute(state.tmdbId)}">
      ${still
        ? `<img class="card-poster" src="${escapeAttribute(still)}" alt="${escapeAttribute(title)}" loading="lazy" />`
        : `<div class="card-poster-placeholder">S${escapeHtml(String(season))}E${escapeHtml(String(number))}</div>`}
      <div class="card-overlay"><div class="overlay-play">▶ Play</div></div>
      <div class="card-info">
        <div class="card-title">${escapeHtml(title)}</div>
        <div class="card-meta">
          ${airDate ? `<span class="card-year">${escapeHtml(getYear(airDate) || airDate)}</span>` : ''}
          ${rating  ? `<span class="card-rating">★ ${escapeHtml(formatRating(rating))}</span>` : ''}
          ${seeds !== '' ? `<span class="card-year">${escapeHtml(String(seeds))} seeds</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderError(message = 'Could not load show') {
  els.showTitle.innerHTML    = 'Show <em>unavailable.</em>';
  els.showMeta.textContent   = 'Check the link or try again later.';
  els.showOverview.innerHTML = '';
  els.episodeGrid.innerHTML  = emptyState(message, 'The Worker did not return show data.');
  els.episodeCount.textContent = '';
}

function emptyState(title, copy) {
  return `<div class="empty empty-full"><div class="empty-icon">📺</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(copy)}</p></div>`;
}

// ── Episode loading & navigation ──────────────────────────────────────────────

async function loadEpisodes() {
  // Can't call EZTV without an IMDB ID
  if (!state.imdbId) {
    renderEpisodes([]);
    return;
  }

  renderEpisodeSkeletons();
  try {
    const payload    = await api.episodes(state.imdbId, state.season);
    state.episodes   = payload.episodes || [];
    renderEpisodes(state.episodes);
  } catch (error) {
    console.error(error);
    renderEpisodes([]);
  }
}

function playEpisode(card) {
  const magnet  = card.dataset.magnet;
  const season  = card.dataset.season;
  const episode = card.dataset.episode;
  const tmdbId  = card.dataset.tmdbId;

  if (!magnet) {
    showToast('No torrent available for this episode');
    return;
  }

  // Navigate to player with the magnet and episode metadata as URL params
  const title = state.show?.name || 'TV Show';
  location.href = `player.html?magnet=${encodeURIComponent(magnet)}`
    + `&title=${encodeURIComponent(`${title} S${season}E${episode}`)}`
    + `&tmdb_id=${encodeURIComponent(tmdbId)}`
    + `&season=${encodeURIComponent(season)}`
    + `&episode=${encodeURIComponent(episode)}`;
}

// ── Event bindings ────────────────────────────────────────────────────────────

function bindEvents() {
  els.seasonPills.addEventListener('click', (event) => {
    const pill = event.target.closest('[data-season]');
    if (!pill) return;
    state.season = Number(pill.dataset.season);
    els.seasonPills.querySelectorAll('.pill').forEach((p) => p.classList.toggle('active', p === pill));
    loadEpisodes();
  });

  els.episodeGrid.addEventListener('click', (event) => {
    const card = event.target.closest('[data-magnet]');
    if (card) playEpisode(card);
  });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function cacheElements() {
  els.showTitle    = document.getElementById('showTitle');
  els.showMeta     = document.getElementById('showMeta');
  els.showRating   = document.getElementById('showRating');
  els.showOverview = document.getElementById('showOverview');
  els.seasonPills  = document.getElementById('seasonPills');
  els.episodeTitle = document.getElementById('episodeTitle');
  els.episodeCount = document.getElementById('episodeCount');
  els.episodeGrid  = document.getElementById('episodeGrid');
  els.toast        = document.getElementById('toast');
}

function normalizeSeasons(show) {
  if (Array.isArray(show.seasons)) {
    // FIX: filter out Season 0 (Specials) — EZTV has no data for it
    return show.seasons.filter((s) => Number(s.season_number ?? s) > 0);
  }
  const count = Number(show.number_of_seasons || 0);
  if (!count) return [];
  return Array.from({ length: count }, (_, i) => ({ season_number: i + 1 }));
}

function getYear(value) {
  if (!value) return '';
  const match = String(value).match(/\d{4}/);
  return match ? match[0] : '';
}

function formatRating(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(1).replace('.0', '') : String(value);
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(els.toast._timer);
  els.toast._timer = setTimeout(() => els.toast.classList.remove('show'), 2400);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  cacheElements();
  bindEvents();

  if (!state.tmdbId) {
    renderError('Missing show ID');
    return;
  }

  renderEpisodeSkeletons();
  try {
    await api.health();
    const payload = await api.show(state.tmdbId);
    // /show returns the TMDB detail object directly (spread at worker level)
    state.show = payload;
    renderShow(state.show);
  } catch (error) {
    console.error(error);
    renderError();
  }
}

document.addEventListener('DOMContentLoaded', init);
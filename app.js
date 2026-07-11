// Configuration
const WORKER = 'https://fancy-bar-b4d2.mogakanewton0.workers.dev';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w342';
const PAGE_SIZE = 20;
const WATCHLIST_KEY = 'dht_watchlist_v2';
const LEGACY_WATCHLIST_KEY = 'dht_watchlist';

// TMDB numeric genre IDs for TV shows — YTS string genres don't apply here
const TV_GENRES = [
  { id: '',     label: 'All'              },
  { id: '18',   label: 'Drama'            },
  { id: '35',   label: 'Comedy'           },
  { id: '10765',label: 'Sci-Fi & Fantasy' },
  { id: '80',   label: 'Crime'            },
  { id: '9648', label: 'Mystery'          },
  { id: '10759',label: 'Action'           },
  { id: '16',   label: 'Animation'        },
  { id: '99',   label: 'Documentary'      },
  { id: '10762',label: 'Kids'             },
];

// YTS string genres for movies
const MOVIE_GENRES = [
  { id: '',            label: 'All'         },
  { id: 'action',      label: 'Action'      },
  { id: 'drama',       label: 'Drama'       },
  { id: 'comedy',      label: 'Comedy'      },
  { id: 'horror',      label: 'Horror'      },
  { id: 'sci-fi',      label: 'Sci-Fi'      },
  { id: 'animation',   label: 'Animation'   },
  { id: 'thriller',    label: 'Thriller'    },
  { id: 'romance',     label: 'Romance'     },
  { id: 'documentary', label: 'Documentary' },
  { id: 'crime',       label: 'Crime'       },
  { id: 'fantasy',     label: 'Fantasy'     },
];

// State
const state = {
  contentType: 'movies',
  query: '',
  genre: '',
  sort: 'download_count',
  page: 1,
  totalPages: 1,
  totalItems: 0,
  watchlistOnly: false,
  debounceTimer: null
};

const els = {};
let watchlist = loadWatchlist();

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

  health()                { return this.request('/health'); },
  stats()                 { return this.request('/stats'); },

  trending(params = {}) {
    return this.request('/trending', { page: state.page, limit: PAGE_SIZE, ...params });
  },

  movies(params = {}) {
    return this.request('/movies', { page: state.page, limit: PAGE_SIZE, sort: state.sort, genre: state.genre, ...params });
  },

  search(query, params = {}) {
    return this.request('/search', { query, page: state.page, limit: PAGE_SIZE, ...params });
  },

  // /shows — query optional; genre must be a TMDB numeric ID string
  shows(params = {}) {
    return this.request('/shows', { page: state.page, ...params });
  },

  movie(id)               { return this.request('/movie', { id }); },

  // FIX: worker expects ?tmdb_id= not ?id=
  show(tmdbId)            { return this.request('/show', { tmdb_id: tmdbId }); },

  meta(params = {})       { return this.request('/meta', params); }
};

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderSkeletons(count = PAGE_SIZE) {
  els.grid.innerHTML = Array.from({ length: count }, () => `
    <div class="skeleton-card">
      <div class="skeleton-poster"></div>
      <div class="skeleton-info">
        <div class="skeleton-line skeleton-line-wide"></div>
        <div class="skeleton-line skeleton-line-half"></div>
      </div>
    </div>
  `).join('');
}

function renderMovies(movies) {
  if (!movies.length) {
    els.grid.innerHTML = emptyState('No movies found', 'Try a different search, genre, or sort.');
    return;
  }
  els.grid.innerHTML = movies.map((movie, index) => movieCard(movie, index)).join('');
}

function renderShows(shows) {
  if (!shows.length) {
    els.grid.innerHTML = emptyState('No shows found', 'Try a different search or genre.');
    return;
  }
  els.grid.innerHTML = shows.map((show, index) => showCard(show, index)).join('');
}

async function renderWatchlist() {
  const saved = getWatchlistItems(state.contentType);
  els.pagination.innerHTML = '';
  els.sectionTitle.textContent = state.contentType === 'shows' ? 'Show Watchlist' : 'Movie Watchlist';
  els.sectionCount.textContent = saved.length ? `${saved.length.toLocaleString()} saved` : '';

  if (!saved.length) {
    els.grid.innerHTML = emptyState('Your watchlist is empty', 'Browse titles and tap + to save them here.');
    return;
  }

  renderSkeletons(Math.min(saved.length, PAGE_SIZE));
  try {
    const requests = saved.map((item) =>
      state.contentType === 'shows'
        ? api.show(item.id)   // item.id is tmdb_id for shows
        : api.movie(item.id)
    );
    const results = await Promise.allSettled(requests);
    const items = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => normalizeDetail(r.value, state.contentType))
      .filter(Boolean);

    if (state.contentType === 'shows') renderShows(items);
    else renderMovies(items);
  } catch (error) {
    console.error(error);
    renderError('Could not load your watchlist');
  }
}

function movieCard(movie, index) {
  const id        = getId(movie);
  const title     = movie.title || movie.name || 'Untitled';
  const poster    = movie.medium_cover_image || movie.large_cover_image || '';
  const year      = movie.year || getYear(movie.date_uploaded || movie.release_date);
  const rating    = movie.rating || movie.imdb_rating || movie.vote_average;
  const qualities = getQualities(movie);
  const saved     = isSaved('movies', id);
  const delay     = Math.min(index * 30, 300);

  return `
    <div class="card" style="animation-delay:${delay}ms" data-id="${escapeAttribute(id)}" data-kind="movies">
      ${poster
        ? `<img class="card-poster" src="${escapeAttribute(poster)}" alt="${escapeAttribute(title)}" loading="lazy" />`
        : posterPlaceholder()}
      <div class="card-overlay">
        <div class="overlay-play">Play</div>
        <div class="overlay-quality">
          ${qualities.slice(0, 3).map((q) =>
            `<span class="quality-badge ${isHd(q) ? 'hd' : ''}">${escapeHtml(q)}</span>`
          ).join('')}
        </div>
      </div>
      <button class="card-watchlist ${saved ? 'saved' : ''}" type="button"
        data-watchlist="movies" data-id="${escapeAttribute(id)}"
        title="${saved ? 'Remove from watchlist' : 'Add to watchlist'}">${saved ? '★' : '☆'}</button>
      <div class="card-info">
        <div class="card-title">${escapeHtml(title)}</div>
        <div class="card-meta">
          ${year   ? `<span class="card-year">${escapeHtml(String(year))}</span>` : ''}
          ${rating ? `<span class="card-rating">★ ${escapeHtml(formatRating(rating))}</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

function showCard(show, index) {
  const id     = getId(show);
  const title  = show.name || show.title || 'Untitled Show';
  const year   = getYear(show.first_air_date || show.release_date || '');
  const rating = show.vote_average || show.rating || '';
  const saved  = isSaved('shows', id);
  const delay  = Math.min(index * 30, 300);

  // FIX: TMDB returns poster_path as a bare path — prefix it
  const poster = show.poster_path
    ? `${TMDB_IMG}${show.poster_path}`
    : show.poster_url || show.medium_cover_image || '';

  return `
    <div class="card" style="animation-delay:${delay}ms" data-id="${escapeAttribute(id)}" data-kind="shows">
      ${poster
        ? `<img class="card-poster" src="${escapeAttribute(poster)}" alt="${escapeAttribute(title)}" loading="lazy" />`
        : posterPlaceholder()}
      <div class="card-overlay"><div class="overlay-play">Open</div></div>
      <button class="card-watchlist ${saved ? 'saved' : ''}" type="button"
        data-watchlist="shows" data-id="${escapeAttribute(id)}"
        title="${saved ? 'Remove from watchlist' : 'Add to watchlist'}">${saved ? '★' : '☆'}</button>
      <div class="card-info">
        <div class="card-title">${escapeHtml(title)}</div>
        <div class="card-meta">
          ${year   ? `<span class="card-year">${escapeHtml(year)}</span>` : ''}
          ${rating ? `<span class="card-rating">★ ${escapeHtml(formatRating(rating))}</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderPagination() {
  if (state.watchlistOnly || state.totalPages <= 1) {
    els.pagination.innerHTML = '';
    return;
  }
  const page  = state.page;
  const total = state.totalPages;
  const pages = new Set([1, 2, page - 1, page, page + 1, total - 1, total].filter((n) => n >= 1 && n <= total));
  let prev    = 0;
  let html    = `<button class="page-btn" type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>Prev</button>`;

  [...pages].sort((a, b) => a - b).forEach((n) => {
    if (prev && n - prev > 1) html += `<span class="page-ellipsis">…</span>`;
    html += `<button class="page-btn ${n === page ? 'active' : ''}" type="button" data-page="${n}">${n}</button>`;
    prev = n;
  });

  html += `<button class="page-btn" type="button" data-page="${page + 1}" ${page === total ? 'disabled' : ''}>Next</button>`;
  els.pagination.innerHTML = html;
}

function updateSectionMeta() {
  const label = state.contentType === 'shows' ? 'Shows' : 'Movies';
  if (state.watchlistOnly) {
    els.sectionTitle.textContent = `${label} Watchlist`;
  } else if (state.query) {
    els.sectionTitle.textContent = `Results for "${state.query}"`;
  } else if (state.genre) {
    // For TV, find the human label for the numeric genre ID
    if (state.contentType === 'shows') {
      const g = TV_GENRES.find((g) => g.id === state.genre);
      els.sectionTitle.textContent = `${g ? g.label : state.genre} Shows`;
    } else {
      els.sectionTitle.textContent = `${capitalize(state.genre)} Movies`;
    }
  } else {
    els.sectionTitle.textContent = state.contentType === 'shows' ? 'Popular TV Shows' : 'Trending Movies';
  }
  els.sectionCount.textContent = state.totalItems ? `${state.totalItems.toLocaleString()} titles` : '';
}

function renderError(message = 'Could not load titles') {
  els.grid.innerHTML = emptyState(message, 'Check your connection or try again.');
  els.pagination.innerHTML = '';
}

function emptyState(title, copy) {
  return `<div class="empty empty-full"><div class="empty-icon">🎬</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(copy)}</p></div>`;
}

function posterPlaceholder() {
  return '<div class="card-poster-placeholder">🎬</div>';
}

// ── Genre pills ───────────────────────────────────────────────────────────────

function buildGenrePills(genres) {
  els.genrePills.innerHTML = genres.map((g) =>
    `<button class="pill ${g.id === state.genre ? 'active' : ''}" type="button" data-genre="${escapeAttribute(g.id)}">${escapeHtml(g.label)}</button>`
  ).join('');
}

function switchGenrePillsForMode() {
  if (state.contentType === 'shows') {
    buildGenrePills(TV_GENRES);
  } else {
    buildGenrePills(MOVIE_GENRES);
  }
}

// ── Navigation & content loading ──────────────────────────────────────────────

async function loadContent() {
  updateUrl();

  if (state.watchlistOnly) {
    await renderWatchlist();
    return;
  }

  renderSkeletons();
  try {
    const data  = await loadCurrentEndpoint();
    const items = extractList(data, state.contentType);
    state.totalItems = extractTotal(data, items.length);
    state.totalPages = Math.max(1, Math.min(Math.ceil(state.totalItems / PAGE_SIZE), 500));

    if (state.contentType === 'shows') {
      renderShows(items);
    } else if (state.query) {
      renderMovies(items);
    } else if (!state.genre) {
      renderMovies(items); // trending
    } else {
      renderMovies(items);
    }

    updateSectionMeta();
    renderPagination();
  } catch (error) {
    console.error(error);
    renderError();
  }
}

function loadCurrentEndpoint() {
  if (state.contentType === 'shows') {
    // Pass genre as TMDB numeric ID; query if present
    const params = {};
    if (state.query) params.query = state.query;
    if (state.genre) params.genre = state.genre;
    return api.shows(params);
  }
  if (state.query) return api.search(state.query);
  if (!state.genre) return api.trending({ sort: state.sort });
  return api.movies();
}

function navigateToItem(kind, id) {
  if (!id) return;
  if (kind === 'shows') {
    // FIX: use tmdb_id param — show.js reads ?tmdb_id=
    location.href = `show.html?tmdb_id=${encodeURIComponent(id)}`;
  } else {
    location.href = `movie.html?id=${encodeURIComponent(id)}`;
  }
}

function goPage(page) {
  const next = Number(page);
  if (!Number.isFinite(next) || next < 1 || next > state.totalPages) return;
  state.page = next;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  loadContent();
}

function updateUrl() {
  const params = new URLSearchParams();
  if (state.contentType !== 'movies') params.set('type', state.contentType);
  if (state.query)  params.set('query', state.query);
  if (state.genre)  params.set('genre', state.genre);
  if (state.sort !== 'download_count') params.set('sort', state.sort);
  if (state.page > 1) params.set('page', String(state.page));
  if (state.watchlistOnly) params.set('watchlist', '1');
  const next = `${location.pathname}${params.toString() ? `?${params}` : ''}`;
  history.replaceState(null, '', next);
}

// ── Watchlist ─────────────────────────────────────────────────────────────────

function loadWatchlist() {
  try {
    const raw    = localStorage.getItem(WATCHLIST_KEY) || localStorage.getItem(LEGACY_WATCHLIST_KEY) || '{}';
    const parsed = JSON.parse(raw);
    // Migrate old flat array (movie IDs only) to new shape
    if (Array.isArray(parsed)) return { movies: parsed.map(String), shows: [] };
    return { movies: parsed.movies || [], shows: parsed.shows || [] };
  } catch {
    return { movies: [], shows: [] };
  }
}

function saveWatchlist() {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
}

function getWatchlistItems(kind) {
  return (watchlist[kind] || []).map((id) => ({ id }));
}

function isSaved(kind, id) {
  return Boolean(id) && (watchlist[kind] || []).map(String).includes(String(id));
}

function toggleWatchlist(kind, id, button) {
  if (!id) return;
  const list  = watchlist[kind] || [];
  const index = list.map(String).indexOf(String(id));
  const saved = index === -1;

  if (saved) list.push(String(id));
  else list.splice(index, 1);

  watchlist[kind] = list;
  saveWatchlist();
  showToast(saved ? 'Added to watchlist' : 'Removed from watchlist');

  if (state.watchlistOnly) {
    loadContent();
  } else if (button) {
    button.classList.toggle('saved', saved);
    button.textContent = saved ? '★' : '☆';
    button.title = saved ? 'Remove from watchlist' : 'Add to watchlist';
  }
}

// ── Event bindings ────────────────────────────────────────────────────────────

function bindEvents() {
  els.searchInput.addEventListener('input', (event) => {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => {
      state.query = event.target.value.trim();
      state.page  = 1;
      loadContent();
    }, 300);
  });

  els.contentTypeToggle.addEventListener('click', (event) => {
    const pill = event.target.closest('[data-type]');
    if (!pill) return;
    state.contentType = pill.dataset.type;
    state.page        = 1;
    state.genre       = '';       // reset genre when switching type
    state.query       = '';
    state.watchlistOnly = false;
    els.searchInput.value       = '';
    els.searchInput.placeholder = state.contentType === 'shows' ? 'Search TV shows...' : 'Search movies...';
    setActivePill(els.contentTypeToggle, pill);
    els.watchlistToggle.classList.remove('active');
    // Rebuild genre pills for the new content type
    switchGenrePillsForMode();
    loadContent();
  });

  // Genre pills use event delegation — works for dynamically rebuilt pills too
  els.genrePills.addEventListener('click', (event) => {
    const pill = event.target.closest('[data-genre]');
    if (!pill) return;
    state.genre = pill.dataset.genre;
    state.page  = 1;
    state.watchlistOnly = false;
    setActivePill(els.genrePills, pill);
    els.watchlistToggle.classList.remove('active');
    loadContent();
  });

  els.sortSelect.addEventListener('change', (event) => {
    state.sort = event.target.value;
    state.page = 1;
    loadContent();
  });

  els.watchlistToggle.addEventListener('click', () => {
    state.watchlistOnly = !state.watchlistOnly;
    state.page = 1;
    els.watchlistToggle.classList.toggle('active', state.watchlistOnly);
    loadContent();
  });

  els.grid.addEventListener('click', (event) => {
    const watchlistBtn = event.target.closest('[data-watchlist]');
    if (watchlistBtn) {
      event.stopPropagation();
      toggleWatchlist(watchlistBtn.dataset.watchlist, watchlistBtn.dataset.id, watchlistBtn);
      return;
    }
    const card = event.target.closest('.card[data-id]');
    if (card) navigateToItem(card.dataset.kind, card.dataset.id);
  });

  els.pagination.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (button && !button.disabled) goPage(button.dataset.page);
  });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function cacheElements() {
  els.searchInput       = document.getElementById('searchInput');
  els.contentTypeToggle = document.getElementById('contentTypeToggle');
  els.genrePills        = document.getElementById('genrePills');
  els.sortSelect        = document.getElementById('sortSelect');
  els.watchlistToggle   = document.getElementById('watchlistToggle');
  els.grid              = document.getElementById('movieGrid');
  els.pagination        = document.getElementById('pagination');
  els.toast             = document.getElementById('toast');
  els.heroStats         = document.getElementById('heroStats');
  els.sectionTitle      = document.getElementById('sectionTitle');
  els.sectionCount      = document.getElementById('sectionCount');
}

function readInitialState() {
  const params        = new URLSearchParams(location.search);
  state.contentType   = params.get('type') === 'shows' ? 'shows' : 'movies';
  state.query         = params.get('query') || '';
  state.genre         = params.get('genre') || '';
  state.sort          = params.get('sort')  || 'download_count';
  state.page          = Math.max(1, Number(params.get('page') || 1));
  state.watchlistOnly = params.get('watchlist') === '1';

  els.searchInput.value       = state.query;
  els.searchInput.placeholder = state.contentType === 'shows' ? 'Search TV shows...' : 'Search movies...';
  els.sortSelect.value        = state.sort;
  els.watchlistToggle.classList.toggle('active', state.watchlistOnly);

  setActiveByValue(els.contentTypeToggle, 'type', state.contentType);

  // Build correct genre pills for initial content type, then set active
  switchGenrePillsForMode();
  setActiveByValue(els.genrePills, 'genre', state.genre);
}

async function initializeHealth() {
  try {
    await api.health();
  } catch (error) {
    console.error(error);
    els.heroStats.textContent = 'DigiFlix is temporarily unavailable. Please try again soon.';
    renderError('DigiFlix is temporarily unavailable');
    throw error;
  }
}

async function initializeStats() {
  try {
    const data   = await api.stats();
    const stats  = data.data || data.stats || data;
    const movies = formatNumber(stats.totalMovies || stats.movies || stats.movie_count || 0);
    const parts  = [];
    if (movies) parts.push(`${movies} movies`);
    parts.push('TV shows from the public DHT swarm');
    els.heroStats.textContent = parts.join(' · ');
  } catch {
    els.heroStats.textContent = 'Movies and TV shows from the public DHT swarm.';
  }
}

function extractList(payload, kind) {
  const data = payload?.data || payload || {};
  if (Array.isArray(data))            return data;
  if (Array.isArray(data.movies))     return data.movies;
  if (Array.isArray(data.shows))      return data.shows;
  if (Array.isArray(data.results))    return data.results;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function extractTotal(payload, fallback) {
  const data = payload?.data || payload || {};
  return Number(
    data.movie_count || data.total_results || data.total_count || data.total || fallback || 0
  );
}

function normalizeDetail(payload, kind) {
  const data = payload?.data || payload || {};
  return data.movie || data.show || data.item ||
    (kind === 'shows' ? data.shows?.[0] : data.movies?.[0]) || data;
}

function getId(item) {
  // For TMDB TV shows the canonical ID is numeric `id`
  return item.id || item.movie_id || item.show_id || item.imdb_code || item.imdb_id || '';
}

function getQualities(movie) {
  const torrents  = Array.isArray(movie.torrents) ? movie.torrents : [];
  const qualities = torrents.map((t) => t.quality).filter(Boolean);
  return [...new Set(qualities)];
}

function isHd(quality) {
  return ['1080p', '2160p', '4K'].includes(String(quality));
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

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1000000) return `${(n / 1000000).toFixed(n >= 10000000 ? 0 : 1)}M`;
  return n.toLocaleString();
}

function setActivePill(container, active) {
  container.querySelectorAll('.pill').forEach((p) => p.classList.toggle('active', p === active));
}

function setActiveByValue(container, name, value) {
  container.querySelectorAll('.pill').forEach((p) => p.classList.toggle('active', p.dataset[name] === value));
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(els.toast._timer);
  els.toast._timer = setTimeout(() => els.toast.classList.remove('show'), 2200);
}

function capitalize(value) {
  return String(value || '').charAt(0).toUpperCase() + String(value || '').slice(1);
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
  readInitialState();
  bindEvents();
  renderSkeletons();
  await initializeHealth();
  initializeStats();
  loadContent();
}

document.addEventListener('DOMContentLoaded', init);
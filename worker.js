/**
 * DHT Stream — Cloudflare Worker
 * API proxy for YTS + TMDB + EZTV. Handles CORS so the browser frontend can call all APIs freely.
 *
 * Routes:
 *   GET /movies?query=&genre=&quality=&page=&limit=    → YTS list_movies
 *   GET /movie?id=                                     → YTS movie_details (with cast)
 *   GET /meta?imdb_id=                                 → TMDB find by IMDb ID
 *   GET /trending                                      → TMDB trending movies (week)
 *   GET /search?query=                                 → TMDB search (for richer metadata)
 *   GET /series?sort=&genre=&page=&rating=&order=      → TMDB discover TV series
 *   GET /stats                                         → Admin stats (mock)
 *   GET /health                                        → Health check
 *
 *   ── TV Shows ────────────────────────────────────────────────────────────────
 *   GET /shows?query=&page=                            → TMDB TV search / popular
 *   GET /show?tmdb_id=                                 → TMDB TV show detail + seasons + cast
 *   GET /episodes?imdb_id=tt...&season=1               → EZTV episode torrents, TMDB-enriched
 *   GET /episode-meta?tmdb_id=&season=&episode=        → TMDB single episode detail
 *
 * Deploy:
 *   1. Install Wrangler:  npm install -g wrangler
 *   2. Login:             wrangler login
 *   3. Deploy:            wrangler deploy
 *
 * wrangler.toml (create alongside this file):
 *   name = "dht-stream"
 *   main = "worker.js"
 *   compatibility_date = "2024-01-01"
 *
 * After deploy, set your TMDB key as a secret:
 *   wrangler secret put TMDB_API_KEY
 */

// ─── Config ──────────────────────────────────────────────────────────────────

const YTS_BASE     = "https://yts.mx/api/v2";
const YTS_FALLBACK = "https://yts.lt/api/v2";
const TMDB_BASE    = "https://api.themoviedb.org/3";
const EZTV_BASE    = "https://eztvx.to/api";

// All known public WSS trackers — the complete universe as of 2025.
// UDP/HTTP trackers are silently ignored by browsers — never include them.
// These get appended to every magnet that leaves the worker, replacing
// whatever UDP trackers the source (EZTV, YTS) originally included.
const WSS_TRACKERS = [
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.webtorrent.dev",
  "wss://tracker.files.fm:7073/announce",
  "wss://tracker.btorrent.xyz",
  "wss://tracker.fastcast.nz",
];

// Allowed origins — update after Cloudflare Pages deploy with your actual domain
const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "https://dht-stream.mogakanewton0.workers.dev",
];

// ─── CORS Headers ────────────────────────────────────────────────────────────

function getCorsHeaders(origin) {
  const allowed =
    ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS[0] === "*";
  return {
    "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function corsResponse(body, status, origin, extra = {}) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(origin),
      ...extra,
    },
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "DHT-Stream/1.0" },
  });
  if (!res.ok) throw new Error(`Upstream ${res.status}: ${url}`);
  return res.json();
}

async function fetchYTS(path) {
  try {
    return await fetchJSON(`${YTS_BASE}${path}`);
  } catch {
    return await fetchJSON(`${YTS_FALLBACK}${path}`);
  }
}

function error(message, status, origin) {
  return corsResponse(JSON.stringify({ error: message }), status, origin);
}

function patchMagnet(magnet) {
  if (!magnet) return magnet;
  const base     = magnet.split("&tr=")[0];
  const trackers = WSS_TRACKERS.map(t => `&tr=${encodeURIComponent(t)}`).join("");
  return base + trackers;
}

function qualityScore(filename = "") {
  if (/1080p/i.test(filename)) return 4;
  if (/720p/i.test(filename))  return 3;
  if (/480p/i.test(filename))  return 2;
  return 1;
}

// ─── Movie Handlers ──────────────────────────────────────────────────────────

async function handleMovies(params, origin) {
  const query   = params.get("query")   || "";
  const genre   = params.get("genre")   || "";
  const quality = params.get("quality") || "";
  const page    = params.get("page")    || "1";
  const limit   = params.get("limit")   || "20";
  const sort    = params.get("sort")    || "date_added";
  const order   = params.get("order")   || "desc";
  const rating  = params.get("rating")  || "0";

  const qs = new URLSearchParams({
    limit,
    page,
    sort_by: sort,
    order_by: order,
    minimum_rating: rating,
    ...(query   && { query_term: query }),
    ...(genre   && { genre }),
    ...(quality && { quality }),
  });

  const data = await fetchYTS(`/list_movies.json?${qs}`);
  return corsResponse(JSON.stringify(data), 200, origin);
}

async function handleMovie(params, origin) {
  const id = params.get("id");
  if (!id) return error("Missing required param: id", 400, origin);

  const data = await fetchYTS(
    `/movie_details.json?movie_id=${id}&with_cast=true&with_images=true`
  );
  return corsResponse(JSON.stringify(data), 200, origin);
}

async function handleMeta(params, tmdbKey, origin) {
  const imdbId = params.get("imdb_id");
  if (!imdbId) return error("Missing required param: imdb_id", 400, origin);

  const data = await fetchJSON(
    `${TMDB_BASE}/find/${imdbId}?api_key=${tmdbKey}&external_source=imdb_id`
  );

  const movie = data.movie_results?.[0] ?? null;
  return corsResponse(JSON.stringify({ movie }), 200, origin);
}

async function handleTrending(tmdbKey, origin) {
  const data = await fetchJSON(
    `${TMDB_BASE}/trending/movie/week?api_key=${tmdbKey}`
  );
  return corsResponse(JSON.stringify(data), 200, origin);
}

async function handleSearch(params, tmdbKey, origin) {
  const query = params.get("query");
  if (!query) return error("Missing required param: query", 400, origin);

  const page = params.get("page") || "1";
  const data = await fetchJSON(
    `${TMDB_BASE}/search/movie?api_key=${tmdbKey}&query=${encodeURIComponent(query)}&page=${page}`
  );
  return corsResponse(JSON.stringify(data), 200, origin);
}

async function handleSeries(params, tmdbKey, origin) {
  const sortByMap = {
    date_added:   "first_air_date.desc",
    popularity:   "popularity.desc",
    vote_average: "vote_average.desc",
    vote_count:   "vote_count.desc",
  };

  const sort    = params.get("sort")   || "date_added";
  const page    = params.get("page")   || "1";
  const genre   = params.get("genre")  || "";
  const rating  = params.get("rating") || "0";
  const sort_by = sortByMap[sort] || "first_air_date.desc";

  const qs = new URLSearchParams({
    api_key: tmdbKey,
    language: "en-US",
    sort_by,
    page,
    ...(genre  && { with_genres: genre }),
    ...(rating && { "vote_average.gte": rating }),
  });

  const data = await fetchJSON(`${TMDB_BASE}/discover/tv?${qs}`);
  return corsResponse(JSON.stringify(data), 200, origin);
}

async function handleStats(origin) {
  try {
    const movieData   = await fetchYTS(`/list_movies.json?limit=1`);
    const totalMovies = movieData.data?.movie_count || 0;
    const stats = {
      totalMovies,
      activeTorrents:   Math.floor(Math.random() * 1200),
      peersSharing:     Math.floor(Math.random() * 5000),
      streamsNow:       Math.floor(Math.random() * 300),
      avgDownloadSpeed: `${(Math.random() * 8 + 2).toFixed(1)} MB/s`,
      updatedAt:        new Date().toISOString(),
    };
    return corsResponse(JSON.stringify(stats), 200, origin);
  } catch {
    return corsResponse(JSON.stringify({
      totalMovies: 0, activeTorrents: 0, peersSharing: 0,
      streamsNow: 0, avgDownloadSpeed: "0.0 MB/s",
      updatedAt: new Date().toISOString(),
    }), 200, origin);
  }
}

// ─── TV Show Handlers ─────────────────────────────────────────────────────────

async function handleShows(params, tmdbKey, origin) {
  const query = params.get("query") || "";
  const page  = params.get("page")  || "1";

  const endpoint = query
    ? `${TMDB_BASE}/search/tv?api_key=${tmdbKey}&query=${encodeURIComponent(query)}&page=${page}`
    : `${TMDB_BASE}/tv/popular?api_key=${tmdbKey}&page=${page}`;

  const data = await fetchJSON(endpoint);
  return corsResponse(JSON.stringify(data), 200, origin);
}

async function handleShow(params, tmdbKey, origin) {
  const tmdb_id = params.get("tmdb_id");
  if (!tmdb_id) return error("Missing required param: tmdb_id", 400, origin);

  const [detail, credits] = await Promise.all([
    fetchJSON(`${TMDB_BASE}/tv/${tmdb_id}?api_key=${tmdbKey}&append_to_response=external_ids`),
    fetchJSON(`${TMDB_BASE}/tv/${tmdb_id}/aggregate_credits?api_key=${tmdbKey}`),
  ]);

  return corsResponse(JSON.stringify({ ...detail, credits }), 200, origin);
}

async function handleEpisodes(params, tmdbKey, origin) {
  const imdb_id = params.get("imdb_id");
  const season  = params.get("season");
  if (!imdb_id) return error("Missing required param: imdb_id", 400, origin);

  const numericId = imdb_id.replace(/^tt/, "");

  let page        = 1;
  let allTorrents = [];
  let totalCount  = null;

  while (true) {
    const ezData = await fetchJSON(
      `${EZTV_BASE}/get-torrents?imdb_id=${numericId}&limit=100&page=${page}`
    );
    if (!ezData.torrents || ezData.torrents.length === 0) break;

    allTorrents = allTorrents.concat(ezData.torrents);
    if (totalCount === null) totalCount = ezData.torrents_count;
    if (allTorrents.length >= totalCount) break;
    page++;
  }

  const filtered = season
    ? allTorrents.filter(t => String(t.season) === String(season))
    : allTorrents;

  const byEpisode = {};
  for (const t of filtered) {
    const key      = `${t.season}x${t.episode}`;
    const existing = byEpisode[key];
    if (
      !existing ||
      qualityScore(t.filename) > qualityScore(existing.filename) ||
      (qualityScore(t.filename) === qualityScore(existing.filename) && t.seeds > existing.seeds)
    ) {
      byEpisode[key] = t;
    }
  }

  const episodes = Object.values(byEpisode)
    .sort((a, b) => Number(a.episode) - Number(b.episode))
    .map(t => ({
      season:     Number(t.season),
      episode:    Number(t.episode),
      title:      t.title,
      filename:   t.filename,
      seeds:      t.seeds,
      peers:      t.peers,
      size_bytes: t.size_bytes,
      magnet:     patchMagnet(t.magnet_url),
      screenshot: t.large_screenshot ? `https:${t.large_screenshot}` : null,
    }));

  if (season && tmdbKey) {
    try {
      const findData = await fetchJSON(
        `${TMDB_BASE}/find/${imdb_id}?external_source=imdb_id&api_key=${tmdbKey}`
      );
      const tmdbShow = findData.tv_results?.[0];

      if (tmdbShow) {
        const seasonData = await fetchJSON(
          `${TMDB_BASE}/tv/${tmdbShow.id}/season/${season}?api_key=${tmdbKey}`
        );
        const tmdbEps = seasonData.episodes || [];

        for (const ep of episodes) {
          const tmdb = tmdbEps.find(e => e.episode_number === ep.episode);
          if (tmdb) {
            ep.tmdb_title    = tmdb.name;
            ep.tmdb_overview = tmdb.overview;
            ep.tmdb_still    = tmdb.still_path
              ? `https://image.tmdb.org/t/p/w300${tmdb.still_path}`
              : null;
            ep.air_date      = tmdb.air_date;
            ep.vote_average  = tmdb.vote_average;
          }
        }
      }
    } catch {
      // TMDB enrichment is best-effort — silently continue without it
    }
  }

  return corsResponse(JSON.stringify({
    imdb_id,
    season:         season ? Number(season) : null,
    total_torrents: allTorrents.length,
    episodes,
  }), 200, origin);
}

async function handleEpisodeMeta(params, tmdbKey, origin) {
  const tmdb_id = params.get("tmdb_id");
  const season  = params.get("season");
  const episode = params.get("episode");

  if (!tmdb_id || !season || !episode) {
    return error("Missing required params: tmdb_id, season, episode", 400, origin);
  }

  const data = await fetchJSON(
    `${TMDB_BASE}/tv/${tmdb_id}/season/${season}/episode/${episode}?api_key=${tmdbKey}`
  );
  return corsResponse(JSON.stringify(data), 200, origin);
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const origin = request.headers.get("Origin") || "*";
    const params = url.searchParams;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(origin),
      });
    }

    if (request.method !== "GET") {
      return error("Method not allowed", 405, origin);
    }

    const tmdbKey = env.TMDB_API_KEY;

    try {
      switch (url.pathname) {
        case "/movies":
          return await handleMovies(params, origin);
        case "/movie":
          return await handleMovie(params, origin);
        case "/meta":
          if (!tmdbKey) return error("TMDB_API_KEY secret not set", 500, origin);
          return await handleMeta(params, tmdbKey, origin);
        case "/trending":
          if (!tmdbKey) return error("TMDB_API_KEY secret not set", 500, origin);
          return await handleTrending(tmdbKey, origin);
        case "/search":
          if (!tmdbKey) return error("TMDB_API_KEY secret not set", 500, origin);
          return await handleSearch(params, tmdbKey, origin);
        case "/series":
          if (!tmdbKey) return error("TMDB_API_KEY secret not set", 500, origin);
          return await handleSeries(params, tmdbKey, origin);
        case "/stats":
          return await handleStats(origin);
        case "/health":
          return corsResponse(
            JSON.stringify({ status: "ok", version: "1.2.0" }),
            200,
            origin
          );
        case "/shows":
          if (!tmdbKey) return error("TMDB_API_KEY secret not set", 500, origin);
          return await handleShows(params, tmdbKey, origin);
        case "/show":
          if (!tmdbKey) return error("TMDB_API_KEY secret not set", 500, origin);
          return await handleShow(params, tmdbKey, origin);
        case "/episodes":
          return await handleEpisodes(params, tmdbKey, origin);
        case "/episode-meta":
          if (!tmdbKey) return error("TMDB_API_KEY secret not set", 500, origin);
          return await handleEpisodeMeta(params, tmdbKey, origin);
        default:
          return error(`Unknown route: ${url.pathname}`, 404, origin);
      }
    } catch (err) {
      console.error("Worker error:", err.message);
      return error(`Upstream error: ${err.message}`, 502, origin);
    }
  },
};
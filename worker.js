/**
 * DHT Stream — Cloudflare Worker
 * API proxy for YTS + TMDB. Handles CORS so the browser frontend can call both APIs freely.
 *
 * Routes:
 *   GET /movies?query=&genre=&quality=&page=&limit=    → YTS list_movies
 *   GET /movie?id=                                     → YTS movie_details (with cast)
 *   GET /meta?imdb_id=                                 → TMDB find by IMDb ID
 *   GET /trending                                      → TMDB trending movies (week)
 *   GET /search?query=                                 → TMDB search (for richer metadata)
 *   GET /stats                                         → Admin stats (mock)
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
 *   (paste your key when prompted — never hardcode it)
 */

// ─── Config ──────────────────────────────────────────────────────────────────

// Keep upstream URLs as single variables — easy to swap if YTS changes domain
const YTS_BASE = "https://yts.mx/api/v2";
const YTS_FALLBACK = "https://yts.lt/api/v2"; // fallback if primary is down
const TMDB_BASE = "https://api.themoviedb.org/3";

// Allowed origins — update after Cloudflare Pages deploy with your actual domain
const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  // "https://your-project.pages.dev",  ← uncomment and replace after Pages deploy
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

// Try primary YTS URL, fall back to mirror on failure
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

// ─── Route Handlers ──────────────────────────────────────────────────────────

// GET /movies — browse & search the YTS catalog
async function handleMovies(params, origin) {
  const query = params.get("query") || "";
  const genre = params.get("genre") || "";
  const quality = params.get("quality") || "";
  const page = params.get("page") || "1";
  const limit = params.get("limit") || "20";
  const sort = params.get("sort") || "date_added";
  const order = params.get("order") || "desc";
  const rating = params.get("rating") || "0";

  const qs = new URLSearchParams({
    limit,
    page,
    sort_by: sort,
    order_by: order,
    minimum_rating: rating,
    ...(query && { query_term: query }),
    ...(genre && { genre }),
    ...(quality && { quality }),
  });

  const data = await fetchYTS(`/list_movies.json?${qs}`);
  return corsResponse(JSON.stringify(data), 200, origin);
}

// GET /movie?id= — full movie details including cast & images
async function handleMovie(params, origin) {
  const id = params.get("id");
  if (!id) return error("Missing required param: id", 400, origin);

  const data = await fetchYTS(
    `/movie_details.json?movie_id=${id}&with_cast=true&with_images=true`
  );
  return corsResponse(JSON.stringify(data), 200, origin);
}

// GET /meta?imdb_id= — TMDB metadata: poster, backdrop, overview, rating
async function handleMeta(params, tmdbKey, origin) {
  const imdbId = params.get("imdb_id");
  if (!imdbId) return error("Missing required param: imdb_id", 400, origin);

  const data = await fetchJSON(
    `${TMDB_BASE}/find/${imdbId}?api_key=${tmdbKey}&external_source=imdb_id`
  );

  // TMDB /find returns arrays — pull the first movie result
  const movie = data.movie_results?.[0] ?? null;
  return corsResponse(JSON.stringify({ movie }), 200, origin);
}

// GET /trending — TMDB weekly trending (great for homepage hero)
async function handleTrending(tmdbKey, origin) {
  const data = await fetchJSON(
    `${TMDB_BASE}/trending/movie/week?api_key=${tmdbKey}`
  );
  return corsResponse(JSON.stringify(data), 200, origin);
}

// GET /search?query= — TMDB movie search (richer than YTS for metadata)
async function handleSearch(params, tmdbKey, origin) {
  const query = params.get("query");
  if (!query) return error("Missing required param: query", 400, origin);

  const page = params.get("page") || "1";
  const data = await fetchJSON(
    `${TMDB_BASE}/search/movie?api_key=${tmdbKey}&query=${encodeURIComponent(
      query
    )}&page=${page}`
  );
  return corsResponse(JSON.stringify(data), 200, origin);
}

// GET /stats — admin stats (mock)
async function handleStats(origin) {
  // Get total movie count from YTS (no filters)
  try {
    const movieData = await fetchYTS(`/list_movies.json?limit=1`);
    const totalMovies = movieData.data?.movie_count || 0;
    // Mock some stats
    const stats = {
      totalMovies,
      activeTorrents: Math.floor(Math.random() * 1200), // random for demo
      peersSharing: Math.floor(Math.random() * 5000),
      streamsNow: Math.floor(Math.random() * 300),
      avgDownloadSpeed: `${(Math.random() * 8 + 2).toFixed(1)} MB/s`,
      updatedAt: new Date().toISOString(),
    };
    return corsResponse(JSON.stringify(stats), 200, origin);
  } catch (err) {
    // fallback mock data
    const stats = {
      totalMovies: 0,
      activeTorrents: 0,
      peersSharing: 0,
      streamsNow: 0,
      avgDownloadSpeed: "0.0 MB/s",
      updatedAt: new Date().toISOString(),
    };
    return corsResponse(JSON.stringify(stats), 200, origin);
  }
}

// GET /series — discover TV series from TMDB
async function handleSeries(params, tmdbKey, origin) {
  // TMDB discover/tv parameters
  const sortByMap = {
    date_added: "first_air_date.desc",
    popularity: "popularity.desc",
    vote_average: "vote_average.desc",
    vote_count: "vote_count.desc",
  };
  const sort = params.get("sort") || "date_added";
  const order = params.get("order") || "desc";
  let sort_by = sortByMap[sort];
  if (!sort_by) {
    // fallback to default
    sort_by = "first_air_date.desc";
  }
  const page = params.get("page") || "1";
  const genre = params.get("genre") || "";
  const rating = params.get("rating") || "0"; // minimum vote average

  const qs = new URLSearchParams({
    api_key: tmdbKey,
    language: "en-US",
    sort_by,
    page,
    ...(genre && { with_genres: genre }),
    ...(rating && { "vote_average.gte": rating }),
  });

  try {
    const data = await fetchJSON(`${TMDB_BASE}/discover/tv?${qs}`);
    return corsResponse(JSON.stringify(data), 200, origin);
  } catch (err) {
    console.error("TMDB discover/tv error:", err.message);
    return error(`Failed to fetch series: ${err.message}`, 502, origin);
  }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "*";
    const params = url.searchParams;

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(origin),
      });
    }

    // Only allow GET
    if (request.method !== "GET") {
      return error("Method not allowed", 405, origin);
    }

    // TMDB key comes from a Wrangler secret — never exposed in code
    const tmdbKey = env.TMDB_API_KEY;

    try {
      switch (url.pathname) {
        case "/movies":
          return await handleMovies(params, origin);

        case "/movie":
          return await handleMovie(params, origin);

        case "/meta":
          if (!tmdbKey)
            return error("TMDB_API_KEY secret not set", 500, origin);
          return await handleMeta(params, tmdbKey, origin);

        case "/trending":
          if (!tmdbKey)
            return error("TMDB_API_KEY secret not set", 500, origin);
          return await handleTrending(tmdbKey, origin);

        case "/search":
          if (!tmdbKey)
            return error("TMDB_API_KEY secret not set", 500, origin);
          return await handleSearch(params, tmdbKey, origin);

        case "/series":
          if (!tmdbKey)
            return error("TMDB_API_KEY secret not set", 500, origin);
          return await handleSeries(params, tmdbKey, origin);

        case "/stats":
          return await handleStats(origin);

        case "/health":
          return corsResponse(
            JSON.stringify({ status: "ok", version: "1.0.0" }),
            200,
            origin
          );

        default:
          return error(`Unknown route: ${url.pathname}`, 404, origin);
      }
    } catch (err) {
      console.error("Worker error:", err.message);
      return error(`Upstream error: ${err.message}`, 502, origin);
    }
  },
};
# DHT Stream

A Cloudflare Worker that acts as an API proxy for YTS (movies) and TMDB (movies and TV series). Handles CORS so the browser frontend can call both APIs freely.

## Features

-   **Movie Catalog**: Browse and search YTS movie library with filters (genre, quality, rating, etc.)
-   **Movie Details**: Get full movie details including cast and images from YTS
-   **TMDB Metadata**: Retrieve rich metadata (posters, backdrops, overview, ratings) from TMDB using IMDb ID
-   **Trending**: Get weekly trending movies from TMDB
-   **Search**: Search for movies on TMDB (useful for richer metadata than YTS)
-   **Series**: Discover TV series from TMDB with filtering options (sort, genre, rating, etc.)
-   **Stats**: Mock admin statistics endpoint
-   **Health Check**: Simple health endpoint
-   **CORS Enabled**: Configured for development and production domains

## API Endpoints

All endpoints return JSON and support CORS.

### Movies

**`GET /movies`**
- Browse and search the YTS catalog
- Query Parameters:
    - `query`: Search term
    - `genre`: Genre ID
    - `quality`: Quality filter (e.g., 720p, 1080p)
    - `page`: Page number (default: 1)
    - `limit`: Results per page (default: 20)
    - `sort`: Sort field (default: date_added)
    - `order`: Sort direction (default: desc)
    - `rating`: Minimum rating (0-10, default: 0)

**`GET /movie?id=`**
- Get full movie details including cast and images
- Query Parameters:
    - `id`: YTS movie ID (required)

### TMDB

**`GET /meta?imdb_id=`**
- Get TMDB metadata by IMDb ID
- Query Parameters:
    - `imdb_id`: IMDb ID (required, e.g., tt0111161)

**`GET /trending`**
- Get weekly trending movies from TMDB

**`GET /search?query=`**
- Search for movies on TMDB
- Query Parameters:
    - `query`: Search term (required)
    - `page`: Page number (default: 1)

**`GET /series?sort=&genre=&page=&rating=&order=`**
- Discover TV series from TMDB
- Query Parameters:
    - `sort`: Sort field (date_added, popularity, vote_average, vote_count) - defaults to date_added
    - `order`: Sort direction (asc/desc) - defaults to desc
    - `page`: Page number (default: 1)
    - `genre`: TMDB genre IDs (for filtering by genre)
    - `rating`: Minimum vote average (0-10) - defaults to 0

### Admin

**`GET /stats`**
- Get mock admin statistics (total movies, active torrents, etc.)

**`GET /health`**
- Health check endpoint returning `{ status: "ok", version: "1.0.0" }`

## Setup and Deployment

### Prerequisites

-   [Node.js](https://nodejs.org/) (for wrangler)
-   A [Cloudflare account](https://dash.cloudflare.com/)
-   A TMDB API key (get one at [https://www.themoviedb.org/settings/api](https://www.themoviedb.org/settings/api))

### Installation

1.  Clone the repository
2.  Install wrangler globally (if not already installed):
    ```bash
    npm install -g wrangler
    ```
3.  Login to Cloudflare:
    ```bash
    wrangler login
    ```

### Configuration

1.  Create a `.env` file in the root directory (copy from `.envexample`):
    ```bash
    cp .envexample .env
    ```
2.  Add your TMDB API key to `.env`:
    ```env
    TMDB_API_KEY = your_tmdb_api_key_here
    ```
3.  Create a `wrangler.toml` file (if not present):
    ```toml
    name = "dht-stream"
    main = "worker.js"
    compatibility_date = "2024-01-01"

    [vars]
    # Optional: you can set defaults here, but secrets are recommended for API keys

    [env.production]
    # Production-specific configuration

    [env.preview]
    # Preview configuration
    ```

### Deploying Secrets

Never hardcode your TMDB API key. Deploy it as a secret:

```bash
wrangler secret put TMDB_API_KEY
```
Then paste your key when prompted.

### Development

To run locally for development:

```bash
wrangler dev
```

This will start a local server at `http://127.0.0.1:8787`.

### Deployment

To deploy to Cloudflare:

```bash
wrangler deploy
```

After deployment, remember to set your TMDB key as a secret in your Cloudflare Worker settings if you haven't already done so via the CLI.

## Environment Variables

-   `TMDB_API_KEY`: Your TMDB API key (required for TMDB endpoints). Set via `wrangler secret put`.

## CORS Configuration

The worker is configured to allow requests from specific origins. Update the `ALLOWED_ORIGINS` array in `worker.js` with your production domain after deploying to Cloudflare Pages or another frontend host.

```javascript
const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  // "https://your-project.pages.dev",  ← uncomment and replace after Pages deploy
];
```

## Notes

-   The worker uses a fallback YTS URL (`https://yts.lt/api/v2`) if the primary (`https://yts.mx/api/v2`) fails.
-   TMDB API calls require a valid API key. If the key is not set, endpoints requiring TMDB will return a 500 error.
-   The `/stats` endpoint returns mock data for demonstration purposes.
-   All endpoints only support GET requests; other methods return 405 Method Not Allowed.

## License

This project is open source and available under the [MIT License](LICENSE).

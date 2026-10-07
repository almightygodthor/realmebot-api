# RealmeBot API v2

A maintained API for resolving Realme devices by codename, model number, device name, alias, or series.

## Major fixes

- Slash-delimited legacy keys are now treated as individual aliases.
- Searches are case-insensitive and punctuation-tolerant.
- Natural names such as "GT Neo 3" resolve correctly.
- RMX3560 and RMX3561 resolve independently.
- lisaa resolves independently.
- Deterministic relevance ranking was added.
- Structured API endpoints were added.
- Health and API discovery endpoints were added.
- Device-list pagination was added.
- JSON 404 and 400 responses were added.
- Automated tests and CI were added.
- Node.js 18+ is now the supported runtime.
- The repository now points to the maintained fork instead of the old upstream metadata.

Express stays on the maintained 4.x line for this first migration to avoid an unnecessary breaking dependency change. The current lockfile remains reproducible.

## API

### Search

GET /api/v1/search?q=<query>

Examples:

- /api/v1/search?q=lisaa
- /api/v1/search?q=RMX3560
- /api/v1/search?q=GT%20Neo%203

Optional limit: 1-100.

### Resolve one device

GET /api/v1/device/<query>

Returns the best matching device.

### Series

GET /api/v1/series/<series>

### Device list

GET /api/v1/devices?offset=0&limit=50

### Health

GET /health

### Legacy compatibility

GET /<query> remains available.

The legacy endpoint now understands slash-separated entries correctly. The raw legacy dataset is available at /legacy.

## Development

    npm install
    npm test
    npm run check
    npm start

The server listens on PORT when provided and defaults to 8080.

## License

GNU GPL v3.0.

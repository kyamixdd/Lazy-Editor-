# Lazy Editor

Lazy Editor is a browser-based document editing and PDF production workspace for editing layouts, managing templates, scanning PDFs, preparing bulk/serial output, and exporting print-ready documents.

## Requirements

- Node.js 22 or newer
- npm

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by the development server.

## Production build

```bash
npm run lint
npm run build
npm start
```

The Express server serves the production build when `NODE_ENV=production`. Set `PORT` to choose a port (defaults to `3000`).

## Optional AI features

AI-assisted analysis requires a Gemini API key configured on the server:

```bash
GEMINI_API_KEY=your_key_here
```

Do not put private API keys in client-side code or commit them to Git.

## Project storage and deployment security

Projects are stored locally in the browser using IndexedDB. Server-side project persistence endpoints are disabled by default because this repository does not yet provide user authentication or per-user project ownership. Do not enable `ENABLE_PROJECT_API=true` on a public deployment unless the service is protected by an authenticated access layer and ownership checks.

Runtime data belongs in `.studio_data/`; it is ignored by Git. If private runtime data was committed in earlier revisions, adding it to `.gitignore` does not remove it from Git history. Review repository history and rotate any exposed credentials; rewrite history only after making a secure backup and coordinating with collaborators.

## Validation

GitHub Actions runs TypeScript checking (`npm run lint`) and a production Vite build (`npm run build`) on pushes and pull requests.

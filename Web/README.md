# Nexo Web

React, TypeScript, and Motion provide the shared interface embedded by the macOS and iOS hosts. Browser development uses synthetic data; native storage, PDF generation, and Google Drive are available through the native bridge only.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build
```

Run these commands in `Web` to use pinned pnpm 11.19.0. The development server listens on `127.0.0.1:5188`. Packaged apps bundle the built resources and do not need a local server.

[Product and build guide](../README.md) · [Native development](../docs/DEVELOPMENT.md) · [Architecture](../docs/ARCHITECTURE.md)

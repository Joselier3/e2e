# e2e with Next.js

A Next.js App Router greeting app with three locator tests and two agent tests.

![Next.js example app with the greeting "hello, Ada!"](screenshot.png)

## Start a new app from this example

`create-next-app` copies this folder into a new directory and installs the
dependencies. Run the commands for your package manager.

npm:

```bash
npx create-next-app --example https://github.com/e2e-inc/e2e/tree/main/examples/with-next my-app
cd my-app
npm run test:e2e
```

pnpm:

```bash
pnpm create next-app --example https://github.com/e2e-inc/e2e/tree/main/examples/with-next my-app
cd my-app
pnpm test:e2e
```

bun:

```bash
bun create next-app --example https://github.com/e2e-inc/e2e/tree/main/examples/with-next my-app
cd my-app
bun run test:e2e
```

## Run

Use Node 22.22.3+, 24.8+, or 26+. From this folder:

```bash
npm install
npm run test:e2e
```

The runner starts the app at `http://localhost:3100`.
It downloads Chromium on the first run if needed.

## Agent tests

Set a [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) key:

```bash
AI_GATEWAY_API_KEY="your-key" npm run test:e2e
```

Without the key, the agent tests skip. Add `-- --no-cache` to use fresh
model calls. Results are in `.e2e/report.json`.

See [e2e.config.ts](e2e.config.ts) and [tests/](tests/) for the setup.
To add e2e to a Next.js app you already have, follow the
[Next.js guide](https://e2e.com/docs/frameworks/nextjs).

Last checked with e2e 0.23.1, @e2e-dev/web 0.16.0, Next.js 16.4, and Node 24.

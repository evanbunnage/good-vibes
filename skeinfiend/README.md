<div align="center">

# <picture><source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg"><img src="docs/logo-light.svg" height="72" alt="SkeinFiend"></picture>

Colorwork chart designer for knitters, with WebMCP support for bring-your-own-agent assisted projects.

**[skeinfiend.com](https://skeinfiend.com)**

</div>

This project was inspired by watching my fiancée do colorwork from scratch. Designing charts
seemed to involve tedious amounts of combing through handwritten notes, sketches, PDFs and pictures from pattern books like _Vogue Knitting_.
Parsing all this unstructured data felt like a great use case for agents to let her focus on the
creative stuff.

SkeinFiend exposes its editing features as tools over [WebMCP](https://github.com/webmachinelearning/webmcp), which
lets an agent do what it's great at (structuring unstructured image data + instructions) and
lets you spend more time designing and experimenting.

The current version uses WebMCP because I think BYO-agent tools are the best way forward for
applications like this. BYOA obviously increases friction for users that aren't used to working with agents, so I'll probably add in-app features later on.

## Tech stack

React and TypeScript built with Vite, using TanStack Router + Query. Deployed on Cloudflare Workers and
PlanetScale's Postgres product.

To make the app feel responsive I used super simple sync logic: user's edits are saved to IndexedDB
and sent to the db server a few seconds later.

## Build from source

Requires Node 22.6 or newer, a Postgres database, and a [Resend](https://resend.com) key for password reset emails.

```sh
npm install
cp .env.example .env
npm run db:migrate
npm run dev            # http://localhost:5173
```

```sh
npm test
npm run typecheck
```

## Deploy

```sh
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put RESEND_API_KEY
npm run deploy
```

## License

[MIT](LICENSE)

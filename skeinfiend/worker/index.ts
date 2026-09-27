import { Pool } from 'pg'
import { createAuth, type AuthEnv } from './auth'
import { poolConfig } from './db'

interface Env extends AuthEnv {
  /** Postgres, locally (from `.env`). Not set deployed: Hyperdrive is used there. */
  readonly DATABASE_URL?: string
  /** Cloudflare's pooled connection to the same Postgres, once it's set up: faster from the edge. */
  readonly HYPERDRIVE?: { readonly connectionString: string }
  readonly ASSETS: { fetch(request: Request): Promise<Response> }
}

/**
 * The app on Cloudflare: its pages from the built assets, and `/api` here.
 * Sign-in is Better Auth's (`/api/auth/*`). Everything else needs a signed-in
 * person, and only ever sees their own rows:
 *
 *   GET    /api/charts          → [{ id, version }]
 *   GET    /api/charts/:id      → { project, version }            404 if none
 *   PUT    /api/charts/:id      { project, summary, baseVersion } → { version }, or 409 { project, version }
 *   DELETE /api/charts/:id
 *   GET    /api/motifs          → [motif]
 *   PUT    /api/motifs/:id      { motif }
 *   DELETE /api/motifs/:id
 *
 * Charts are stored as the app sends them (grids as base64), never decoded here.
 * Each is at most MAX_BODY_BYTES, and an account keeps at most MAX_CHARTS.
 */
const MAX_BODY_BYTES = 4 * 1024 * 1024
const MAX_CHARTS = 500
const MAX_MOTIFS = 1000

export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)
    // Locally, straight to Postgres (Hyperdrive's local stand-in doesn't speak TLS, which PlanetScale requires).
    // Deployed there's no DATABASE_URL, so it's Hyperdrive, which pools connections near the database.
    const connectionString = env.DATABASE_URL ?? env.HYPERDRIVE?.connectionString
    if (!connectionString) return json({ error: 'No database is set up.' }, 500)
    // One connection per request: a Worker doesn't keep them between requests (Hyperdrive pools them for us).
    const pool = new Pool(poolConfig(connectionString))
    try {
      const auth = createAuth(pool, env)
      if (url.pathname.startsWith('/api/auth/')) return await auth.handler(request)
      const session = await auth.api.getSession({ headers: request.headers })
      if (!session) return json({ error: 'Sign in first.' }, 401)
      if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return json({ error: 'That’s too large to save.' }, 413)
      return await route(request, url, pool, session.user.id)
    } catch (error) {
      console.error(error)
      return json({ error: 'Something went wrong.' }, 500)
    } finally {
      ctx.waitUntil(pool.end())
    }
  },
}

async function route(request: Request, url: URL, db: Pool, owner: string): Promise<Response> {
  const [, , kind, rawId] = url.pathname.split('/')
  const id = rawId ? decodeURIComponent(rawId) : undefined
  const method = request.method

  if (kind === 'charts') {
    if (!id && method === 'GET') {
      const { rows } = await db.query('select id, version from charts where owner = $1', [owner])
      return json(rows)
    }
    if (id && method === 'GET') {
      const { rows } = await db.query('select doc, version from charts where owner = $1 and id = $2', [owner, id])
      return rows[0] ? json({ project: rows[0].doc, version: rows[0].version }) : json({ error: 'No such chart.' }, 404)
    }
    if (id && method === 'PUT') {
      const body = await readBody(request)
      if (body === TOO_LARGE) return json({ error: 'That’s too large to save.' }, 413)
      const { project, summary, baseVersion } = (body ?? {}) as Record<string, unknown>
      if (!isObject(project) || !isObject(summary) || !(baseVersion === null || Number.isInteger(baseVersion)) || !Number.isFinite(project.updatedAt)) {
        return json({ error: 'That isn’t a chart.' }, 400)
      }
      if (project.id !== id) return json({ error: 'The chart’s id doesn’t match.' }, 400)
      if (baseVersion === null && (await count(db, 'charts', owner)) >= MAX_CHARTS) return json({ error: `An account keeps up to ${MAX_CHARTS} charts.` }, 403)
      // Saved only over the version it was based on: someone else's newer save isn't lost.
      const { rows } = await db.query(
        `insert into charts (owner, id, version, updated_at, summary, doc) values ($1, $2, 1, $3, $4, $5)
         on conflict (owner, id) do update
           set version = charts.version + 1, updated_at = excluded.updated_at, summary = excluded.summary, doc = excluded.doc
           where charts.version = $6
         returning version`,
        [owner, id, project.updatedAt, JSON.stringify(summary), JSON.stringify(project), baseVersion ?? -1],
      )
      if (rows[0]) return json({ version: rows[0].version })
      const current = await db.query('select doc, version from charts where owner = $1 and id = $2', [owner, id])
      return json({ project: current.rows[0]?.doc, version: current.rows[0]?.version }, 409)
    }
    if (id && method === 'DELETE') {
      await db.query('delete from charts where owner = $1 and id = $2', [owner, id])
      return new Response(null, { status: 204 })
    }
  }

  if (kind === 'motifs') {
    if (!id && method === 'GET') {
      const { rows } = await db.query('select doc from colorwork_motifs where owner = $1', [owner])
      return json(rows.map((r) => r.doc))
    }
    if (id && method === 'PUT') {
      const body = await readBody(request)
      if (body === TOO_LARGE) return json({ error: 'That’s too large to save.' }, 413)
      const { motif } = (body ?? {}) as Record<string, unknown>
      if (!isObject(motif) || !Number.isFinite(motif.savedAt) || !(motif.editedAt === undefined || Number.isFinite(motif.editedAt))) {
        return json({ error: 'That isn’t a colorwork motif.' }, 400)
      }
      if (motif.id !== id) return json({ error: 'The motif’s id doesn’t match.' }, 400)
      const exists = await db.query('select 1 from colorwork_motifs where owner = $1 and id = $2', [owner, id])
      if (!exists.rows[0] && (await count(db, 'colorwork_motifs', owner)) >= MAX_MOTIFS) return json({ error: `An account keeps up to ${MAX_MOTIFS} colorwork motifs.` }, 403)
      await db.query(
        `insert into colorwork_motifs (owner, id, edited_at, doc) values ($1, $2, $3, $4)
         on conflict (owner, id) do update set edited_at = excluded.edited_at, doc = excluded.doc`,
        [owner, id, motif.editedAt ?? motif.savedAt, JSON.stringify(motif)],
      )
      return new Response(null, { status: 204 })
    }
    if (id && method === 'DELETE') {
      await db.query('delete from colorwork_motifs where owner = $1 and id = $2', [owner, id])
      return new Response(null, { status: 204 })
    }
  }
  return json({ error: 'Not found.' }, 404)
}

const TOO_LARGE = Symbol('too large')

/**
 * The request's JSON: TOO_LARGE past MAX_BODY_BYTES (whatever its
 * content-length said), or null if it isn't JSON. Its shape is checked by
 * each route: what's stored is only ever read back by its owner.
 */
async function readBody(request: Request): Promise<unknown> {
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return TOO_LARGE
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function count(db: Pool, table: 'charts' | 'colorwork_motifs', owner: string): Promise<number> {
  const { rows } = await db.query(`select count(*)::int as n from ${table} where owner = $1`, [owner])
  return rows[0].n
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-content-type-options': 'nosniff' } })
}

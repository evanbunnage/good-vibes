/**
 * Creates the database's tables, or adds what's missing: Better Auth's, then
 * the app's. Safe to run again.
 *
 *   before `npm run dev`            the local Postgres
 *   npm run db:migrate:production   DATABASE_URL from .env.production: a role that
 *                                   may create tables (PlanetScale's default role)
 */
import { getMigrations } from 'better-auth/db/migration'
import pg from 'pg'
import { authOptions } from '../worker/auth.ts'
import { poolConfig } from '../worker/db.ts'
import { APP_SCHEMA } from '../worker/schema.ts'

const LOCAL = 'postgres://postgres:postgres@localhost:5432/skeinfiend'
const connectionString = process.env.DATABASE_URL ?? LOCAL
console.log(`Migrating ${new URL(connectionString).host}.`)
const pool = new pg.Pool(poolConfig(connectionString))
try {
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(authOptions(pool, { BETTER_AUTH_SECRET: 'migrations-only' }))
  const auth = [...toBeCreated.map((t) => `create ${t.table}`), ...toBeAdded.map((t) => `add to ${t.table}`)]
  await runMigrations()
  console.log(auth.length ? `Sign-in tables: ${auth.join(', ')}.` : 'Sign-in tables: up to date.')
  await pool.query(APP_SCHEMA)
  console.log('App tables: charts, colorwork_motifs.')
} finally {
  await pool.end()
}

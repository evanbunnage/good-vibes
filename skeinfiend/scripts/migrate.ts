/**
 * Creates the database's tables, or adds what's missing: Better Auth's, then
 * the app's. Safe to run again. Making tables takes a role that may create
 * them (PlanetScale's default role): DEFAULT_DATABASE_URL, from .env. The
 * app itself connects as a role that only reads and writes rows
 * (DATABASE_URL), which covers these tables too.
 *
 *   npm run db:migrate
 */
import { getMigrations } from 'better-auth/db/migration'
import pg from 'pg'
import { authOptions } from '../worker/auth.ts'
import { poolConfig } from '../worker/db.ts'
import { APP_SCHEMA } from '../worker/schema.ts'

const connectionString = process.env.DEFAULT_DATABASE_URL
if (!connectionString) throw new Error('DEFAULT_DATABASE_URL isn’t set: add the default role’s connection string to .env.')
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

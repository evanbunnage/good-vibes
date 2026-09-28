import type { PoolConfig } from 'pg'

/**
 * A Postgres connection string as `pg` can use it anywhere, a Worker included.
 * PlanetScale's strings ask for TLS checked against the system's certificates
 * (`sslrootcert=system`, `sslmode=verify-full`); `pg` would read `system` as a
 * file, and a Worker has no files. So TLS is asked for directly instead, still
 * checking the server's certificate.
 */
export function poolConfig(connectionString: string): PoolConfig {
  const url = new URL(connectionString)
  const mode = url.searchParams.get('sslmode')
  const tls = url.searchParams.has('sslrootcert') || (mode !== null && mode !== 'disable')
  url.searchParams.delete('sslrootcert')
  url.searchParams.delete('sslmode')
  return { connectionString: url.toString(), max: 1, ...(tls && { ssl: { rejectUnauthorized: true } }) }
}

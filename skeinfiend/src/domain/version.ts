import { SCHEMA_VERSION, type Project } from './project'

/**
 * A stored project, checked to be in the one form this version reads. Older
 * forms aren't read any more; a newer one means this copy of SkeinFiend is
 * out of date.
 */
export function checkVersion(stored: unknown): Project {
  const { schemaVersion } = stored as { schemaVersion: number }
  if (schemaVersion > SCHEMA_VERSION) {
    throw new Error(`This project was saved by a newer version of SkeinFiend (version ${schemaVersion}).`)
  }
  if (schemaVersion !== SCHEMA_VERSION) throw new Error(`This project was saved in an old form SkeinFiend no longer reads (version ${schemaVersion}).`)
  return stored as Project
}

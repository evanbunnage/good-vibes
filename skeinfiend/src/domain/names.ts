/**
 * A name nothing else has, so each is told apart in a list: "Snowflake hat",
 * or "Snowflake hat 2" if that's taken (ignoring case). Blank, the fallback.
 */
export function uniqueName(name: string, taken: Iterable<string>, fallback: string): string {
  const names = new Set([...taken].map((n) => n.toLowerCase()))
  const base = name.trim() || fallback
  if (!names.has(base.toLowerCase())) return base
  let n = 2
  while (names.has(`${base} ${n}`.toLowerCase())) n++
  return `${base} ${n}`
}

import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext } from 'react'
import { MOTIF_LIBRARY } from '@/domain/motifs'
import { uniqueMotifName, type SavedMotif } from '@/domain/saved-motifs'

/**
 * The designer's own motifs, kept apart from any one project so they can be
 * used in all of them. Like projects, the UI only sees this interface.
 */
export interface LibraryRepository {
  motifs(): Promise<SavedMotif[]>
  putMotif(motif: SavedMotif): Promise<void>
  removeMotif(id: string): Promise<void>
}

export const LibraryContext = createContext<LibraryRepository | null>(null)

export function useLibrary(): LibraryRepository {
  const library = useContext(LibraryContext)
  if (!library) throw new Error('useLibrary needs a LibraryContext provider')
  return library
}

const keys = {
  motifs: ['library', 'motifs'] as const,
}

export function useSavedMotifs() {
  const library = useLibrary()
  return useQuery(queryOptions({ queryKey: keys.motifs, queryFn: () => library.motifs() }))
}

/** Saved under a name no other motif has ("Snowflake 2" beside SkeinFiend's Snowflake), so each is told apart. */
export function useSaveMotif() {
  return useLibraryMutation(keys.motifs, async (library, motif: SavedMotif) =>
    library.putMotif({ ...motif, name: uniqueMotifName(motif, await library.motifs(), MOTIF_LIBRARY.map((m) => m.name)) }))
}

export function useDeleteMotif() {
  return useLibraryMutation(keys.motifs, (library, id: string) => library.removeMotif(id))
}

function useLibraryMutation<T>(key: readonly string[], write: (library: LibraryRepository, value: T) => Promise<void>) {
  const library = useLibrary()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (value: T) => write(library, value),
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  })
}

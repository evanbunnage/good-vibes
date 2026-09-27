import { createContext, useCallback, useContext, useEffect, useRef, useSyncExternalStore } from 'react'
import { useSaveProject } from '@/data/projects'
import type { Project } from '@/domain/project'
import type { EditorState, EditorStore } from '@/editor/store'

export const EditorContext = createContext<EditorStore | null>(null)

export function useEditorStore(): EditorStore {
  const store = useContext(EditorContext)
  if (!store) throw new Error('useEditorStore needs an EditorContext provider')
  return store
}

/**
 * Subscribes to one slice of editor state. The selector must return a value
 * that's stable when nothing it reads has changed (a field, or a memoized
 * derivation from the store), so unrelated edits don't re-render.
 */
export function useEditor<T>(selector: (state: EditorState, store: EditorStore) => T): T {
  const store = useEditorStore()
  const select = useCallback(() => selector(store.getState(), store), [store, selector])
  return useSyncExternalStore(store.subscribe, select, select)
}

/** The current project, including an in-progress stroke. */
export function useProject(): Project {
  return useEditor(selectProject)
}

const selectProject = (_: EditorState, store: EditorStore) => store.project

const SAVE_DELAY = 600

/**
 * Whether the open chart has edits not yet written in this browser: from the
 * first edit until its save lands (a moment later). Then the sync, if
 * someone's signed in, says how it stands on the server.
 */
let editsPending = false
const pendingListeners = new Set<() => void>()
function setEditsPending(pending: boolean): void {
  if (pending === editsPending) return
  editsPending = pending
  for (const listener of pendingListeners) listener()
}

export function useEditsPending(): boolean {
  return useSyncExternalStore(
    (listener) => {
      pendingListeners.add(listener)
      return () => pendingListeners.delete(listener)
    },
    () => editsPending,
  )
}

/**
 * Saves the editor's committed project shortly after each change, and right
 * away when the page is hidden or the editor closes, so nothing is lost.
 */
export function useAutosave(store: EditorStore): void {
  const save = useSaveProject()
  const saveRef = useRef(save.mutate)
  saveRef.current = save.mutate

  useEffect(() => {
    let saved = store.getState().history.present
    let timer: ReturnType<typeof setTimeout> | undefined

    const flush = () => {
      clearTimeout(timer)
      const present = store.getState().history.present
      if (present === saved) return
      saved = present
      saveRef.current({ ...present, updatedAt: Date.now() }, { onSettled: () => setEditsPending(false) })
    }

    const unsubscribe = store.subscribe(() => {
      const { history, draft } = store.getState()
      if (draft || history.present === saved) return
      setEditsPending(true)
      clearTimeout(timer)
      timer = setTimeout(flush, SAVE_DELAY)
    })
    const onHide = () => document.visibilityState === 'hidden' && flush()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)

    return () => {
      unsubscribe()
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [store])
}

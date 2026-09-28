import { createContext, useCallback, useContext, useEffect, useRef, useSyncExternalStore } from 'react'
import { useSaveProject } from '@/data/projects'
import type { Project } from '@/domain/project'
import type { EditorState, EditorStore } from '@/editor/store'
import { ChartConflictError, ChartGoneError } from '@/data/remote-repository'

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

/** Whether the editor has edits not yet saved in this browser (a moment's worth, at most). */
export function hasPendingEdits(): boolean {
  return editsPending
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
export function useAutosave(store: EditorStore, onRefused: (error: ChartConflictError | ChartGoneError) => void): void {
  const save = useSaveProject()
  const refusedRef = useRef(onRefused)
  refusedRef.current = onRefused
  // The save's own promise, not a callback on it: a callback is dropped if the editor has closed
  // by the time the save lands (leaving to sign in, say), and the edits would look pending for good.
  const saveRef = useRef(save.mutateAsync)
  saveRef.current = save.mutateAsync

  useEffect(() => {
    let saved = store.getState().history.present
    let timer: ReturnType<typeof setTimeout> | undefined

    let saving = 0
    // Refused (someone else's newer save, or the chart deleted): this editor's copy is set aside,
    // so nothing more of it is saved, not even as it closes, or it would go over theirs.
    let setAside = false
    // Nothing waiting: no save under way, and no edit since the last one.
    const settle = () => {
      if (setAside || (saving === 0 && timer === undefined && store.getState().history.present === saved)) setEditsPending(false)
    }
    const flush = () => {
      clearTimeout(timer)
      timer = undefined
      if (setAside) return
      const present = store.getState().history.present
      // Edited and then undone back to what's saved: nothing to save.
      if (present === saved) return settle()
      saved = present
      saving++
      saveRef.current({ ...present, updatedAt: Date.now() })
        .catch((error: unknown) => {
          // Someone else's newer save, or the chart deleted: the editor decides what happens
          // (keeps a copy of what's here, then shows theirs; or goes home).
          if (error instanceof ChartConflictError || error instanceof ChartGoneError) {
            setAside = true
            clearTimeout(timer)
            timer = undefined
            refusedRef.current(error)
          } else console.error(error)
        })
        .finally(() => {
          saving--
          settle()
        })
    }

    const unsubscribe = store.subscribe(() => {
      const { history, draft } = store.getState()
      if (setAside || draft || history.present === saved) return
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

import type { MouseEvent } from 'react'
import { isTauriRuntime } from './tauri'

const nonDragSelector = [
  'a',
  'button',
  'input',
  'textarea',
  'select',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[data-no-tauri-drag]',
].join(',')

function shouldStartWindowDrag(target: EventTarget | null, currentTarget: HTMLElement) {
  if (!(target instanceof HTMLElement)) return true
  if (!currentTarget.contains(target)) return false

  return !target.closest(nonDragSelector)
}

export function startTauriWindowDrag(event: MouseEvent<HTMLElement>) {
  if (event.button !== 0 || !isTauriRuntime()) return
  if (!shouldStartWindowDrag(event.target, event.currentTarget)) return

  void import('@tauri-apps/api/window')
    .then(({ getCurrentWindow }) => getCurrentWindow().startDragging())
    .catch((error) => {
      console.warn('[tauri] Failed to start window dragging', error)
    })
}

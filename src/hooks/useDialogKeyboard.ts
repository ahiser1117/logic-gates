import { useEffect } from 'react'

export function useDialogKeyboard(
  isOpen: boolean,
  onClose: () => void,
  onConfirm: (() => void) | null
) {
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'Enter' && onConfirm) {
        onConfirm()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, onConfirm])
}

/**
 * App-styled confirmation dialog (replaces window.confirm everywhere).
 * Usage: const confirm = useConfirm(); if (await confirm({ title, body, confirm: 'Resign', danger: true })) …
 * Accessible: role="alertdialog", focus moves to the safe button, Escape cancels, Enter confirms,
 * focus returns to the triggering element on close.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

export interface ConfirmOptions { title: string; body?: ReactNode; confirm?: string; cancel?: string; danger?: boolean }
type Ask = (o: ConfirmOptions) => Promise<boolean>

const Ctx = createContext<Ask>(async () => false)
export const useConfirm = () => useContext(Ctx)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null)
  const back = useRef<HTMLElement | null>(null)
  const ask = useCallback<Ask>((o) => new Promise((resolve) => { back.current = document.activeElement as HTMLElement; setReq({ ...o, resolve }) }), [])
  const close = (v: boolean) => { req?.resolve(v); setReq(null); setTimeout(() => back.current?.focus(), 0) }
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!req) return
    cancelRef.current?.focus()
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false) }
      if (e.key === 'Enter') { e.preventDefault(); close(true) }
      e.stopPropagation()
    }
    addEventListener('keydown', h, true)
    return () => removeEventListener('keydown', h, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req])
  return (
    <Ctx.Provider value={ask}>
      {children}
      {req && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/75 p-4" onMouseDown={() => close(false)}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" className={`panel w-full max-w-sm p-5 ${req.danger ? 'border-bad/60' : 'border-line-strong'}`}
            onMouseDown={(e) => e.stopPropagation()}>
            <div className="label mb-2">{req.danger ? '[!] confirm' : 'confirm'}</div>
            <h2 id="confirm-title" className="text-[16px] font-semibold tracking-[.02em]">{req.title}</h2>
            {req.body && <div className="mt-2 text-[12px] leading-relaxed text-muted">{req.body}</div>}
            <div className="mt-5 flex justify-end gap-2">
              <button ref={cancelRef} className="btn" onClick={() => close(false)}>{req.cancel ?? 'Cancel'} <kbd className="text-[10px] opacity-60">esc</kbd></button>
              <button className={`btn ${req.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)}>{req.confirm ?? 'OK'} <kbd className="text-[10px] opacity-60">↵</kbd></button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}

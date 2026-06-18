import type { ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  confirmText?: string
  cancelText?: string
  onConfirm?: () => void
  confirmDisabled?: boolean
}

export default function CommonDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmText = '确认',
  cancelText = '取消',
  onConfirm,
  confirmDisabled,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[92%] max-w-sm rounded-2xl p-0 gap-0 border-0 ring-0 shadow-xl bg-white overflow-hidden">
        <div className="px-6 pt-6 pb-3">
          <DialogHeader className="p-0">
            <DialogTitle className="text-[16px] font-semibold text-slate-800">
              {title}
            </DialogTitle>
            {description && (
              <DialogDescription className="text-sm text-slate-500 mt-1">
                {description}
              </DialogDescription>
            )}
          </DialogHeader>

          <div className="mt-4">
            {children}
          </div>
        </div>

        <DialogFooter className="px-6 py-4 flex-row justify-end gap-2.5 border-0 bg-transparent -mx-0 -mb-0 rounded-none">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="rounded-lg border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-700 text-sm h-9 px-4"
          >
            {cancelText}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={confirmDisabled}
            className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm h-9 px-4 shadow-none disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

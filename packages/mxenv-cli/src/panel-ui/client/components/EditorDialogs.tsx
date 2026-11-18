import type { FormEvent } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { sourceLabel, type EditorState, type PendingAction } from '@/types'

interface EditorDialogsProps {
  editor: EditorState | null
  pending: PendingAction | null
  busy: boolean
  onEditorChange: (editor: EditorState | null) => void
  onPendingChange: (pending: PendingAction | null) => void
  onConfirm: () => void
}

export function EditorDialogs({
  editor,
  pending,
  busy,
  onEditorChange,
  onPendingChange,
  onConfirm,
}: EditorDialogsProps) {
  const requestConfirmation = (event: FormEvent) => {
    event.preventDefault()
    if (editor?.key && editor.value) onPendingChange({ type: 'set' })
  }
  const confirmationKey = pending?.type === 'set' ? editor?.key : pending?.target.key
  const confirmationSource = pending?.type === 'set' ? editor?.source : pending?.target.source

  return (
    <>
      <AlertDialog
        open={Boolean(editor) && !pending}
        onOpenChange={(open) => {
          if (!open && !pending) onEditorChange(null)
        }}
      >
        <AlertDialogContent>
          <form onSubmit={requestConfirmation}>
            <AlertDialogHeader>
              <AlertDialogTitle>{editor?.mode === 'add' ? 'Add key' : 'Set value'}</AlertDialogTitle>
              <AlertDialogDescription>
                The current value is never prefilled. Values are sent only to this local panel host.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="my-5 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="panel-key">Key</Label>
                <Input
                  id="panel-key"
                  value={editor?.key ?? ''}
                  readOnly={editor?.mode === 'update'}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono read-only:bg-muted/40"
                  onChange={(event) => editor && onEditorChange({ ...editor, key: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="panel-value">New value</Label>
                <Input
                  id="panel-value"
                  type="password"
                  value={editor?.value ?? ''}
                  autoComplete="off"
                  autoFocus={editor?.mode === 'update'}
                  className="font-mono"
                  onChange={(event) => editor && onEditorChange({ ...editor, value: event.target.value })}
                />
              </div>
              <p className="text-xs text-muted-foreground">Source: {sourceLabel(editor?.source ?? '')}</p>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => onEditorChange(null)}>Cancel</AlertDialogCancel>
              <Button type="submit" disabled={!editor?.key || !editor.value}>Review change</Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(pending)} onOpenChange={(open) => !open && onPendingChange(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.type === 'delete' ? 'Delete this key?' : 'Confirm value update'}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  <code className="font-mono text-foreground">{confirmationKey}</code> in {sourceLabel(confirmationSource ?? '')}
                </p>
                <p>
                  {pending?.type === 'delete'
                    ? 'This removes the key from the selected source. The panel cannot undo this operation.'
                    : 'The new value will be written to the selected source. Its current value will not be shown.'}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={pending?.type === 'delete' ? 'destructive' : 'default'}
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                onConfirm()
              }}
            >
              {busy ? 'Writing…' : pending?.type === 'delete' ? 'Delete key' : 'Confirm update'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

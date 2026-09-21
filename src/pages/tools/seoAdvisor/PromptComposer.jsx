import React, { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { defaultPromptValues } from './constants'

function interpolate(prompt, values) {
  if (!prompt?.template) return ''
  return prompt.template(values)
}

export default function PromptComposer({
  prompt,
  ci,
  open,
  onOpenChange,
  onFeed,
}) {
  const [values, setValues] = useState({})
  const [promptText, setPromptText] = useState('')
  const [manualEdit, setManualEdit] = useState(false)

  useEffect(() => {
    if (!prompt || !open) return
    const next = defaultPromptValues(prompt, ci)
    setValues(next)
    setPromptText(interpolate(prompt, next))
    setManualEdit(false)
  }, [prompt, ci, open])

  const livePrompt = useMemo(() => interpolate(prompt, values), [prompt, values])

  useEffect(() => {
    if (!manualEdit) setPromptText(livePrompt)
  }, [livePrompt, manualEdit])

  function setField(key, value) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  if (!prompt) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-lg"
      >
        <SheetHeader className="text-left">
          <SheetTitle>{prompt.title}</SheetTitle>
          <SheetDescription>{prompt.desc}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {prompt.fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <label className="flex items-center gap-2 text-xs font-medium">
                {field.label}
                {field.ci && (
                  <Badge variant="outline" className="text-[10px] font-normal">
                    from CI
                  </Badge>
                )}
              </label>
              {field.type === 'textarea' ? (
                <Textarea
                  rows={2}
                  value={values[field.key] || ''}
                  onChange={(e) => setField(field.key, e.target.value)}
                />
              ) : field.type === 'select' ? (
                <Select
                  value={values[field.key] || field.options?.[0]}
                  onValueChange={(value) => setField(field.key, value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(field.options || []).map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={values[field.key] || ''}
                  placeholder={field.placeholder}
                  readOnly={Boolean(field.readOnly)}
                  onChange={(e) => setField(field.key, e.target.value)}
                />
              )}
            </div>
          ))}

          <div className="space-y-1.5">
            <label className="flex items-center justify-between text-xs font-medium">
              Prompt
              <span className="font-normal text-muted-foreground">
                editable · updates live
              </span>
            </label>
            <Textarea
              rows={8}
              value={promptText}
              onChange={(e) => {
                setManualEdit(true)
                setPromptText(e.target.value)
              }}
              className="font-mono text-xs"
            />
          </div>
        </div>

        <SheetFooter className="mt-6">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              const text = promptText.trim()
              if (!text) return
              onFeed(text)
              onOpenChange(false)
            }}
          >
            Feed to chat
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

import { Button, EmptyState, ScrollShadow, SearchField, Tooltip } from '@heroui/react'
import { EMOJI_CATEGORIES, EMOJI_SKIN_TONES, EmojiPicker } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import emojisList from 'emojibase-data/en/compact.json'
import { useMemo, useRef, useState } from 'react'

type Emoji = (typeof emojisList)[0]

type EmojiPickerFieldProps = {
  value: string
  isDisabled?: boolean
  onChange: (value: string) => void
}

const emojis: Emoji[] = emojisList.filter(
  (emoji) => typeof emoji.label === 'string' && !emoji.label.startsWith('regional indicator'),
)

const CATEGORY_GROUP_MAP: Record<string, number> = {
  activities: 6,
  'animals-nature': 3,
  flags: 9,
  'food-drink': 4,
  objects: 7,
  'people-body': 1,
  'smileys-emotion': 0,
  symbols: 8,
  'travel-places': 5,
}

function EmojiPickerField({ value, isDisabled = false, onChange }: EmojiPickerFieldProps) {
  const [skinTone, setSkinTone] = useState('default')
  const gridRef = useRef<HTMLDivElement>(null)

  const displayEmojis = useMemo(() => {
    const skinIndex = EMOJI_SKIN_TONES.findIndex((tone) => tone.id === skinTone) - 1

    if (skinIndex < 0) return emojis

    return emojis.map((emoji) => {
      const skin = emoji.skins?.[skinIndex]

      if (!skin) return emoji

      return { ...emoji, unicode: skin.unicode }
    })
  }, [skinTone])

  const categoryStartIndices = useMemo(() => {
    const indices: Record<string, number> = {}

    for (const [categoryId, groupNum] of Object.entries(CATEGORY_GROUP_MAP)) {
      const index = displayEmojis.findIndex((emoji) => emoji.group === groupNum)

      if (index !== -1) indices[categoryId] = index
    }

    return indices
  }, [displayEmojis])

  const scrollToCategory = (categoryId: string) => {
    const grid = gridRef.current

    if (!grid) return

    const index = categoryStartIndices[categoryId]

    if (index === undefined) return

    const itemSize = 38
    const itemsPerRow = Math.floor(grid.clientWidth / itemSize)
    const scrollTop = Math.floor(index / itemsPerRow) * itemSize

    grid.scrollTo({ behavior: 'smooth', top: scrollTop })
  }

  return (
    <div className="space-y-2">
      <span className="text-xs font-medium text-muted">Emoji</span>
      <EmojiPicker
        key={value || '😀'}
        aria-label="Emoji"
        defaultValue={value || '😀'}
        onSelectionChange={(key) => onChange(key == null ? '' : String(key))}
        isDisabled={isDisabled}
      >
        <EmojiPicker.Trigger className="flex size-10 items-center justify-center rounded-xl border border-divider bg-surface-secondary/50 text-xl outline-none transition-colors hover:bg-surface disabled:opacity-60">
          <EmojiPicker.Value />
        </EmojiPicker.Trigger>
        <EmojiPicker.Popover>
          <EmojiPicker.Content>
            <SearchField aria-label="Search emoji" variant="secondary">
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="Search emoji..." />
                <EmojiPicker.SkinTonePicker value={skinTone} onChange={setSkinTone}>
                  <EmojiPicker.SkinToneTrigger className="mr-1" />
                  <EmojiPicker.SkinToneContent>
                    {EMOJI_SKIN_TONES.map((tone) => (
                      <EmojiPicker.SkinToneOption key={tone.id} aria-label={tone.label} id={tone.id}>
                        {tone.emoji}
                      </EmojiPicker.SkinToneOption>
                    ))}
                  </EmojiPicker.SkinToneContent>
                </EmojiPicker.SkinTonePicker>
              </SearchField.Group>
            </SearchField>
            <EmojiPicker.Grid
              ref={gridRef}
              items={displayEmojis}
              renderEmptyState={() => (
                <EmptyState className="flex h-full min-h-20 flex-1 flex-col items-center justify-center gap-2">
                  <Icon icon="lucide:search" className="size-5 text-muted" />
                  No emoji found.
                </EmptyState>
              )}
            >
              {(item) => (
                <EmojiPicker.Item
                  id={String(item.unicode)}
                  textValue={`${item.label || ''} ${Array.isArray(item.tags) ? item.tags.join(' ') : ''}`}
                >
                  {item.unicode}
                </EmojiPicker.Item>
              )}
            </EmojiPicker.Grid>
            <EmojiPicker.Footer>
              <ScrollShadow hideScrollBar orientation="horizontal">
                <div className="flex items-center gap-1 overflow-visible px-2 py-0.5 pr-3">
                  {EMOJI_CATEGORIES.map(({ emoji, id, label }) => (
                    <Tooltip key={emoji} delay={0}>
                      <Button
                        excludeFromTabOrder
                        isIconOnly
                        aria-label={label}
                        className="flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-muted/20"
                        variant="ghost"
                        onPress={() => scrollToCategory(id)}
                      >
                        <span className="text-base" tabIndex={-1}>
                          {emoji}
                        </span>
                      </Button>
                      <Tooltip.Content placement="top">
                        <p>{label}</p>
                      </Tooltip.Content>
                    </Tooltip>
                  ))}
                </div>
              </ScrollShadow>
            </EmojiPicker.Footer>
          </EmojiPicker.Content>
        </EmojiPicker.Popover>
      </EmojiPicker>
    </div>
  )
}

export default EmojiPickerField

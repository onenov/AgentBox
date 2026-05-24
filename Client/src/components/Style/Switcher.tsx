import { Icon } from '@iconify/react'
import { Button, ColorSwatchPicker, Dropdown, Header, Label, Popover } from '@heroui/react'
import { CellSlider, Segment } from '@heroui-pro/react'
import type { ThemeColor, ThemeStyle } from '@/stores/theme'
import { themeColorOptions, themeFontOptions, useThemeStore } from '@/stores/theme'

const themeStyleOptions: Array<{
  label: string
  value: ThemeStyle
  icon: string
}> = [
    {
      label: 'Glass',
      value: 'glass',
      icon: 'lucide:sparkles',
    },
    {
      label: 'Default',
      value: 'default',
      icon: 'lucide:palette',
    },
  ]

const themeColorLabels: Record<ThemeColor, string> = {
  lime: 'Lime',
  green: 'Green',
  red: 'Red',
  orange: 'Orange',
  pink: 'Pink',
  emerald: 'Emerald',
  teal: 'Teal',
  cyan: 'Cyan',
  sky: 'Sky',
  blue: 'Blue',
  indigo: 'Indigo',
  violet: 'Violet',
  purple: 'Purple',
  neutral: 'Neutral',
}

const normalizeHexColor = (color: string) => color.toLowerCase().replace(/ff$/, '')

const getPreviewBackground = (themeStyle: ThemeStyle, color: string) => {
  if (themeStyle === 'glass') return `radial-gradient(circle at center, ${color} 0%, ${color} 36%, ${color}80 66%, ${color}00 100%)`

  return color
}

function StyleSwitcher() {
  const themeStyle = useThemeStore((state) => state.themeStyle)
  const themeColor = useThemeStore((state) => state.themeColor)
  const themeGeneralRadius = useThemeStore((state) => state.themeGeneralRadius)
  const themeFormsRadius = useThemeStore((state) => state.themeFormsRadius)
  const themeFont = useThemeStore((state) => state.themeFont)
  const setThemeStyle = useThemeStore((state) => state.setThemeStyle)
  const setThemeColor = useThemeStore((state) => state.setThemeColor)
  const setThemeGeneralRadius = useThemeStore((state) => state.setThemeGeneralRadius)
  const setThemeFormsRadius = useThemeStore((state) => state.setThemeFormsRadius)
  const setThemeFont = useThemeStore((state) => state.setThemeFont)
  const resetThemeStyle = useThemeStore((state) => state.resetThemeStyle)
  const currentColor = themeColorOptions.find((option) => option.value === themeColor) ?? themeColorOptions[0]
  const currentFont = themeFontOptions.find((option) => option.label === themeFont) ?? themeFontOptions[3]
  const previewBackground = getPreviewBackground(themeStyle, currentColor.color)

  return (
    <Popover>
      <Button size="sm" isIconOnly aria-label="主题风格" variant="tertiary" className="p-1">
        <span className="block size-4.5 rounded-full" style={{ background: previewBackground }} />
      </Button>
      <Popover.Content placement="bottom">
        {/* <Popover.Arrow /> */}
        <Popover.Dialog>
          <div className="flex w-64 flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-base font-medium text-foreground">THEME</p>
              </div>

              <div className="flex items-center gap-2">
                <Dropdown>
                  <Button aria-label="选择字体" size="sm" variant="tertiary">
                    <span className="truncate" style={{ fontFamily: currentFont.value }}>FONT</span>
                    <Icon icon="lucide:chevron-down" className="size-4 text-muted" />
                  </Button>
                  <Dropdown.Popover>
                    <Dropdown.Menu>
                      <Dropdown.Section
                        selectedKeys={new Set([themeFont])}
                        selectionMode="single"
                        onSelectionChange={(keys) => {
                          if (keys === 'all') return

                          const [key] = Array.from(keys)
                          const nextFont = themeFontOptions.find((option) => option.label === String(key))
                          if (nextFont) setThemeFont(nextFont.label)
                        }}
                      >
                        <Header>Font</Header>
                        {themeFontOptions.map((option) => (
                          <Dropdown.Item key={option.label} id={option.label} textValue={option.label}>
                            <Dropdown.ItemIndicator type="dot" />
                            <Label style={{ fontFamily: option.value }}>{option.label}</Label>
                          </Dropdown.Item>
                        ))}
                      </Dropdown.Section>
                    </Dropdown.Menu>
                  </Dropdown.Popover>
                </Dropdown>

                <Button isIconOnly aria-label="重置主题风格" size="sm" variant="tertiary" onPress={resetThemeStyle}>
                  <Icon icon="lucide:rotate-ccw" className="size-4" />
                </Button>
              </div>
            </div>

            <Segment selectedKey={themeStyle} onSelectionChange={(key) => {
              if (key === 'glass' || key === 'default') setThemeStyle(key)
            }}>
              {themeStyleOptions.map((option) => (
                <Segment.Item key={option.value} id={option.value}>
                  <Segment.Separator />
                  <Icon icon={option.icon} className="size-4" />
                  {option.label}
                </Segment.Item>
              ))}
            </Segment>

            <div className="flex flex-col gap-3">
              <CellSlider
                aria-label="General Radius"
                formatOptions={{ maximumFractionDigits: 2, minimumFractionDigits: 2 }}
                minValue={0}
                maxValue={1}
                step={0.01}
                variant="secondary"
                value={themeGeneralRadius}
                onChange={(value) => setThemeGeneralRadius(Array.isArray(value) ? value[0] : value)}
              >
                <CellSlider.Track>
                  <CellSlider.Fill />
                  <CellSlider.Thumb />
                  <CellSlider.Label>General Radius</CellSlider.Label>
                  <CellSlider.Output />
                </CellSlider.Track>
              </CellSlider>

              <CellSlider
                aria-label="Forms Radius"
                formatOptions={{ maximumFractionDigits: 2, minimumFractionDigits: 2 }}
                minValue={0}
                maxValue={1}
                step={0.01}
                variant="secondary"
                value={themeFormsRadius}
                onChange={(value) => setThemeFormsRadius(Array.isArray(value) ? value[0] : value)}
              >
                <CellSlider.Track>
                  <CellSlider.Fill />
                  <CellSlider.Thumb />
                  <CellSlider.Label>Forms Radius</CellSlider.Label>
                  <CellSlider.Output />
                </CellSlider.Track>
              </CellSlider>
            </div>

            <div className="flex flex-col gap-2">
              <ColorSwatchPicker
                aria-label="主题配色"
                value={currentColor.color}
                onChange={(color) => {
                  const nextColor = normalizeHexColor(color.toString('hexa'))
                  const nextOption = themeColorOptions.find((option) => normalizeHexColor(option.color) === nextColor)

                  if (nextOption) setThemeColor(nextOption.value)
                }}
                className="grid grid-cols-7 gap-2"
              >
                {themeColorOptions.map((option) => (
                  <ColorSwatchPicker.Item key={option.value} color={option.color} aria-label={themeColorLabels[option.value]}>
                    <ColorSwatchPicker.Swatch />
                    <ColorSwatchPicker.Indicator />
                  </ColorSwatchPicker.Item>
                ))}
              </ColorSwatchPicker>
            </div>
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}

export default StyleSwitcher

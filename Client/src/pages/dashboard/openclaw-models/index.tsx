import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Key } from '@heroui/react'
import { AlertDialog, Button, Card, Chip, InputGroup, Label, ListBox, SearchField, Separator, Skeleton, Switch, TextField, Tooltip, toast } from '@heroui/react'
import { CellSelect, ItemCard, ItemCardGroup } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import type { OpenClawConfigResponse, OpenClawDefaultModelConfig, OpenClawModelApiType, OpenClawModelDefinition, OpenClawModelProvider } from '@/api'
import { fetchOpenClawProviderModels, getOpenClawConfig, testOpenClawProviderModel, updateOpenClawConfig } from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import { openExternalUrl as openUrl } from '@/utils/openExternalUrl'
import DashboardLayout from '@/layouts/Dashboard'
import { useConfigStore } from '@/stores/config'

type LoadState = 'idle' | 'loading' | 'saving' | 'ready' | 'error'

type ProviderDraft = OpenClawModelProvider & {
  key: string
}

type ProviderPresetButton = {
  label: string
  link: string
}

type ProviderPreset = {
  api: OpenClawModelApiType
  apiKey?: string
  apiKeyUrl?: string
  baseUrl: string
  buttons?: ProviderPresetButton[]
  description?: string
  docsUrl?: string
  icon?: string
  key: string
  logoUrl?: string
  models: OpenClawModelDefinition[]
  name: string
}

type ProviderEditorMode = 'create' | 'edit'

type ProviderFormState = {
  api: OpenClawModelApiType
  apiKey: string
  baseUrl: string
  contextWindow: string
  key: string
  maxTokens: string
  presetKey: string
}

type AddModelFormState = {
  contextWindow: string
  id: string
  name: string
  reasoning: boolean
}

type CatalogModelEntry = {
  contextWindow?: number
  icon?: string
  id: string
  name?: string
  reasoning?: boolean
  vision?: boolean
}

type ModelCatalog = Record<string, CatalogModelEntry[]>

type ProviderCatalogEntry = {
  apiKeyUrl?: string
  assistantApiType?: string
  baseUrl: string
  docsUrl?: string
  icon?: string
  key: string
  label: string
  logoUrl?: string
  modelApi: string
  models: CatalogModelEntry[]
}

type ProviderCatalog = ProviderCatalogEntry[]

const apiTypeOptions: OpenClawModelApiType[] = [
  'openai-completions',
  'openai-responses',
  'openai-codex-responses',
  'anthropic-messages',
  'google-generative-ai',
  'github-copilot',
  'bedrock-converse-stream',
  'ollama',
  'azure-openai-responses',
]

const emptyProviderForm: ProviderFormState = {
  api: 'openai-completions',
  apiKey: '',
  baseUrl: '',
  contextWindow: '',
  key: '',
  maxTokens: '',
  presetKey: '',
}

const emptyAddModelForm: AddModelFormState = {
  contextWindow: '',
  id: '',
  name: '',
  reasoning: false,
}

const manualPresetKey = '__manual__'

function OpenClawModelsPage() {
  usePageTitle('OpenClaw 模型配置')
  const modelCatalogUrl = useConfigStore((store) => store.modelCatalogUrl)
  const modelInitializationUrl = useConfigStore((store) => store.modelInitializationUrl)
  const [state, setState] = useState<LoadState>('idle')
  const [configData, setConfigData] = useState<OpenClawConfigResponse | null>(null)
  const [rawContent, setRawContent] = useState<Record<string, unknown>>({})
  const [savedConfigFingerprint, setSavedConfigFingerprint] = useState('')
  const [providers, setProviders] = useState<ProviderDraft[]>([])
  const [selectedProviderKey, setSelectedProviderKey] = useState('')
  const [defaultModel, setDefaultModel] = useState<OpenClawDefaultModelConfig>({ primary: '', fallbacks: [] })
  const [fallbackText, setFallbackText] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [providerEditorOpen, setProviderEditorOpen] = useState(false)
  const [providerEditorMode, setProviderEditorMode] = useState<ProviderEditorMode>('create')
  const [providerEditorOriginalKey, setProviderEditorOriginalKey] = useState('')
  const [providerForm, setProviderForm] = useState<ProviderFormState>(emptyProviderForm)
  const [fetchedProviderModels, setFetchedProviderModels] = useState<OpenClawModelDefinition[]>([])
  const [hasFetchedProviderModels, setHasFetchedProviderModels] = useState(false)
  const [providerEditorAddedModels, setProviderEditorAddedModels] = useState<OpenClawModelDefinition[]>([])
  const [providerEditorReplacementModels, setProviderEditorReplacementModels] = useState<OpenClawModelDefinition[] | null>(null)
  const [removedProviderModelIds, setRemovedProviderModelIds] = useState<string[]>([])
  const [isFetchingProviderModels, setIsFetchingProviderModels] = useState(false)
  const [modelCatalog, setModelCatalog] = useState<ModelCatalog>({})
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalog>([])
  const [modelInitializationPreset, setModelInitializationPreset] = useState<ProviderPreset | null>(null)
  const providerEditorScrollAnchorRef = useRef<HTMLDivElement | null>(null)
  const previousProviderEditorOpenRef = useRef(providerEditorOpen)

  const loadConfig = useCallback(async () => {
    setState('loading')
    setError('')

    try {
      const payload = await getOpenClawConfig()
      const content = payload.content ?? {}
      const nextProviders = configToProviderDrafts(content)
      const nextDefault = readDefaultModelConfig(content)
      setConfigData(payload)
      setRawContent(content)
      setSavedConfigFingerprint(configFingerprint(content, nextProviders, nextDefault))
      setProviders(nextProviders)
      setSelectedProviderKey((current) => current && nextProviders.some((provider) => provider.key === current) ? current : nextProviders[0]?.key ?? '')
      setDefaultModel(nextDefault)
      setFallbackText((nextDefault.fallbacks ?? []).join('\n'))
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : '模型配置加载失败')
      setState('error')
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadConfig()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [loadConfig])

  const loadLogoCatalog = useCallback(async () => {
    try {
      const response = await fetch(modelCatalogUrl)
      const payload = response.ok ? await response.json() as ProviderCatalog : []
      const catalog = Array.isArray(payload) ? payload : []

      setProviderCatalog(catalog)
      setModelCatalog(Object.fromEntries(catalog.map((provider) => [provider.key, provider.models ?? []])))
    } catch {
      setModelCatalog({})
      setProviderCatalog([])
    }
  }, [modelCatalogUrl])

  const loadModelInitializationPreset = useCallback(async () => {
    try {
      const response = await fetch(modelInitializationUrl)
      const payload = response.ok ? await response.json() : null
      const preset = modelInitializationToPreset(payload)
      setModelInitializationPreset(preset)
      setProviderCatalog((current) => preset ? mergeProviderCatalogEntries([presetToProviderCatalogEntry(preset)], current) : current)
    } catch {
      setModelInitializationPreset(null)
    }
  }, [modelInitializationUrl])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadLogoCatalog()
      void loadModelInitializationPreset()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [loadLogoCatalog, loadModelInitializationPreset])

  useEffect(() => {
    const previousProviderEditorOpen = previousProviderEditorOpenRef.current
    previousProviderEditorOpenRef.current = providerEditorOpen

    if (previousProviderEditorOpen || !providerEditorOpen) return

    const frame = window.requestAnimationFrame(() => {
      providerEditorScrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [providerEditorOpen])

  const filteredProviders = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return providers
    return providers.filter((provider) => {
      const modelIds = (provider.models ?? []).map((model) => `${model.id} ${model.name ?? ''}`).join(' ')
      return `${provider.key} ${provider.baseUrl ?? ''} ${provider.api ?? ''} ${modelIds}`.toLowerCase().includes(needle)
    })
  }, [providers, query])
  const hasProviderQuery = Boolean(query.trim())
  const hasProviders = providers.length > 0
  const selectedProvider = useMemo(() => {
    if (filteredProviders.some((provider) => provider.key === selectedProviderKey)) {
      return filteredProviders.find((provider) => provider.key === selectedProviderKey) ?? null
    }
    return filteredProviders[0] ?? null
  }, [filteredProviders, selectedProviderKey])
  const providerPresets = useMemo(() => mergeProviderPresets(
    modelInitializationPreset ? [modelInitializationPreset] : [],
    providerCatalogToPresets(providerCatalog),
  ), [modelInitializationPreset, providerCatalog])
  const availableProviderPresets = useMemo(() => providerPresets.filter(
    (preset) => !providers.some((provider) => sameProviderKey(provider.key, preset.key)),
  ), [providerPresets, providers])
  const hasInitializationProvider = useMemo(() => Boolean(
    modelInitializationPreset && providers.some((provider) => provider.key.toLowerCase() === modelInitializationPreset.key.toLowerCase()),
  ), [modelInitializationPreset, providers])
  const primaryModelSummary = useMemo(() => resolveModelReference(defaultModel.primary ?? '', providers), [defaultModel.primary, providers])

  const stats = useMemo(() => {
    const modelCount = providers.reduce((sum, provider) => sum + (provider.models?.length ?? 0), 0)
    return { providerCount: providers.length, modelCount }
  }, [providers])

  const isLoading = state === 'loading' && !configData
  const isSaving = state === 'saving'
  const refreshButtonVariant = state === 'loading' ? 'danger' : state === 'error' ? 'primary' : 'ghost'
  const effectiveDefaultModel = useMemo(() => withAutoDefaultModel(providers, {
    primary: defaultModel.primary?.trim() || '',
    fallbacks: parseModelLines(fallbackText),
  }), [defaultModel.primary, fallbackText, providers])
  const nextConfigContent = useMemo(() => buildConfigContent(rawContent, providers, effectiveDefaultModel), [effectiveDefaultModel, providers, rawContent])
  const hasUnsavedChanges = useMemo(() => {
    if (!savedConfigFingerprint) return false
    return JSON.stringify(nextConfigContent) !== savedConfigFingerprint
  }, [nextConfigContent, savedConfigFingerprint])

  useEffect(() => {
    if (!hasUnsavedChanges) return

    toast.warning('模型配置有未保存修改', {
      description: '修改只在当前页面草稿中，点击保存后才会写入配置文件。',
    })
  }, [hasUnsavedChanges])

  const openCreateProviderEditor = useCallback(() => {
    setProviderEditorMode('create')
    setProviderEditorOriginalKey('')
    setProviderForm(emptyProviderForm)
    setFetchedProviderModels([])
    setHasFetchedProviderModels(false)
    setProviderEditorAddedModels([])
    setProviderEditorReplacementModels(null)
    setRemovedProviderModelIds([])
    setProviderEditorOpen(true)
  }, [])

  const openInitializationProviderEditor = useCallback(() => {
    if (!modelInitializationPreset || hasInitializationProvider) return

    setProviderEditorMode('create')
    setProviderEditorOriginalKey('')
    setProviderForm({
      ...emptyProviderForm,
      api: modelInitializationPreset.api,
      apiKey: modelInitializationPreset.apiKey ?? '',
      baseUrl: modelInitializationPreset.baseUrl,
      key: modelInitializationPreset.key,
      presetKey: modelInitializationPreset.key,
    })
    setFetchedProviderModels([])
    setHasFetchedProviderModels(false)
    setProviderEditorAddedModels([])
    setProviderEditorReplacementModels(null)
    setRemovedProviderModelIds([])
    setProviderEditorOpen(true)
  }, [hasInitializationProvider, modelInitializationPreset])

  const openEditProviderEditor = useCallback((provider: ProviderDraft) => {
    const matchedPreset = providerPresets.find((preset) => sameProviderKey(preset.key, provider.key))

    setProviderEditorMode('edit')
    setProviderEditorOriginalKey(provider.key)
    setProviderForm({
      api: (provider.api as OpenClawModelApiType | undefined) ?? 'openai-completions',
      apiKey: typeof provider.apiKey === 'string' ? provider.apiKey : '',
      baseUrl: provider.baseUrl ?? '',
      contextWindow: numberInput(provider.contextWindow),
      key: provider.key,
      maxTokens: numberInput(provider.maxTokens),
      presetKey: matchedPreset && !modelInitializationPresetKeyMatchesProvider(matchedPreset, provider) ? matchedPreset.key : '',
    })
    setFetchedProviderModels([])
    setHasFetchedProviderModels(false)
    setProviderEditorAddedModels([])
    setProviderEditorReplacementModels(null)
    setRemovedProviderModelIds([])
    setProviderEditorOpen(true)
  }, [providerPresets])

  const applyProviderPreset = useCallback((presetKey: string) => {
    const preset = providerPresets.find((item) => item.key === presetKey)
    setFetchedProviderModels([])
    setHasFetchedProviderModels(false)
    setProviderEditorAddedModels([])
    setProviderEditorReplacementModels(null)
    setRemovedProviderModelIds([])
    setProviderForm((current) => preset
      ? { ...current, api: preset.api, apiKey: preset.apiKey ?? current.apiKey, baseUrl: preset.baseUrl, key: preset.key, presetKey }
      : { ...current, presetKey: '' })
  }, [providerPresets])

  useEffect(() => {
    if (!providerEditorOpen || providerEditorMode !== 'create' || !modelInitializationPreset || hasInitializationProvider) return
    if (providerForm.presetKey || providerForm.key || providerForm.baseUrl || providerForm.apiKey) return

    const timeoutId = window.setTimeout(() => {
      applyProviderPreset(modelInitializationPreset.key)
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [applyProviderPreset, hasInitializationProvider, modelInitializationPreset, providerEditorMode, providerEditorOpen, providerForm.apiKey, providerForm.baseUrl, providerForm.key, providerForm.presetKey])

  const fetchProviderModels = useCallback(async () => {
    const baseUrl = providerForm.baseUrl.trim()
    if (!baseUrl) {
      toast.warning('请先填写 Base URL')
      return
    }

    setIsFetchingProviderModels(true)
    try {
      const payload = await fetchOpenClawProviderModels({
        api: providerForm.api,
        apiKey: providerForm.apiKey.trim(),
        baseUrl,
        contextWindow: parseOptionalNumber(providerForm.contextWindow),
        maxTokens: parseOptionalNumber(providerForm.maxTokens),
      })
      setFetchedProviderModels(payload.models.map((model) => enrichModelContext({ ...model })))
      setHasFetchedProviderModels(true)
      toast.success(`已获取 ${payload.models.length} 个模型`)
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '获取模型列表失败')
    } finally {
      setIsFetchingProviderModels(false)
    }
  }, [providerForm])

  const clearFetchedProviderModels = useCallback(() => {
    setFetchedProviderModels([])
    setHasFetchedProviderModels(false)
  }, [])

  const submitProviderForm = useCallback(() => {
    const key = toSafeProviderKey(providerForm.key)
    if (!key) {
      toast.warning('请输入 Provider ID')
      return
    }
    const duplicate = providers.some((provider) => sameProviderKey(provider.key, key) && !sameProviderKey(provider.key, providerEditorOriginalKey))
    if (duplicate) {
      toast.warning('Provider ID 已存在')
      return
    }

    const preset = providerPresets.find((item) => item.key === providerForm.presetKey)
    const shouldUsePresetModels = Boolean(preset && (providerEditorMode === 'create' || preset.key !== providerEditorOriginalKey))
    const baseModels = providerEditorReplacementModels ?? (shouldUsePresetModels
      ? preset?.models ?? []
      : providers.find((provider) => sameProviderKey(provider.key, providerEditorOriginalKey))?.models ?? [])
    const sourceModels = mergeModelsById(baseModels, providerEditorAddedModels)
    const patch: ProviderDraft = {
      api: providerForm.api,
      apiKey: providerForm.apiKey.trim(),
      baseUrl: providerForm.baseUrl.trim(),
      contextWindow: parseOptionalNumber(providerForm.contextWindow),
      key,
      maxTokens: parseOptionalNumber(providerForm.maxTokens),
      models: sourceModels.filter((model) => !removedProviderModelIds.includes(model.id)).map((model) => ({ ...model })),
    }

    if (providerEditorMode === 'create') {
      setProviders((current) => [...current, patch])
      setSelectedProviderKey(key)
    } else {
      setProviders((current) => current.map((provider) => sameProviderKey(provider.key, providerEditorOriginalKey) ? { ...provider, ...patch } : provider))
      if (providerEditorOriginalKey !== key) {
        setSelectedProviderKey(key)
        setDefaultModel((current) => renameModelRefs(current, providerEditorOriginalKey, key))
        setFallbackText((current) => renameModelRefLines(current, providerEditorOriginalKey, key))
      }
    }

    setProviderEditorOpen(false)
  }, [providerEditorAddedModels, providerEditorMode, providerEditorOriginalKey, providerEditorReplacementModels, providerForm, providerPresets, providers, removedProviderModelIds])

  const deleteProvider = useCallback((providerKey: string) => {
    setProviders((current) => {
      const nextProviders = current.filter((provider) => provider.key !== providerKey)
      setSelectedProviderKey((currentKey) => currentKey === providerKey ? nextProviders[0]?.key ?? '' : currentKey)
      return nextProviders
    })
    setDefaultModel((current) => removeProviderRefs(current, providerKey))
    setFallbackText((current) => parseModelLines(current).filter((ref) => !ref.startsWith(`${providerKey}/`)).join('\n'))
  }, [])

  const addModelToProvider = useCallback((providerKey: string, model: OpenClawModelDefinition) => {
    const provider = providers.find((item) => item.key === providerKey)
    if (!provider) return
    const nextModel = enrichModelContext(model)
    setProviders((current) => current.map((item) => item.key === providerKey ? { ...item, models: mergeModelsById(item.models ?? [], [nextModel]) } : item))
    setSelectedProviderKey(providerKey)
  }, [providers])

  const deleteModel = useCallback((providerKey: string, modelId: string) => {
    setProviders((current) => current.map((provider) => {
      if (provider.key !== providerKey) return provider
      return { ...provider, models: (provider.models ?? []).filter((model) => model.id !== modelId) }
    }))
    const modelRef = `${providerKey}/${modelId}`
    setDefaultModel((current) => ({
      primary: current.primary === modelRef ? '' : current.primary,
      fallbacks: (current.fallbacks ?? []).filter((fallback) => fallback !== modelRef),
    }))
    setFallbackText((current) => parseModelLines(current).filter((fallback) => fallback !== modelRef).join('\n'))
  }, [])

  const setPrimaryModel = useCallback((providerKey: string, modelId: string) => {
    const modelRef = `${providerKey}/${modelId}`
    setDefaultModel((current) => ({
      primary: modelRef,
      fallbacks: (current.fallbacks ?? []).filter((fallback) => fallback !== modelRef),
    }))
    setFallbackText((current) => parseModelLines(current).filter((fallback) => fallback !== modelRef).join('\n'))
  }, [])

  const toggleFallbackModel = useCallback((providerKey: string, modelId: string) => {
    const modelRef = `${providerKey}/${modelId}`
    setDefaultModel((current) => {
      if (current.primary === modelRef) return current
      const fallbacks = current.fallbacks ?? []
      return fallbacks.includes(modelRef)
        ? { ...current, fallbacks: fallbacks.filter((fallback) => fallback !== modelRef) }
        : { ...current, fallbacks: [...fallbacks, modelRef] }
    })
    setFallbackText((current) => {
      const fallbacks = parseModelLines(current).filter((fallback) => fallback !== defaultModel.primary)
      return fallbacks.includes(modelRef)
        ? fallbacks.filter((fallback) => fallback !== modelRef).join('\n')
        : [...fallbacks, modelRef].join('\n')
    })
  }, [defaultModel.primary])

  const saveConfig = useCallback(async () => {
    setState('saving')
    setError('')

    try {
      const nextContent = nextConfigContent
      const payload = await updateOpenClawConfig(nextContent)
      const content = payload.content ?? nextContent
      const nextProviders = configToProviderDrafts(content)
      const nextDefault = readDefaultModelConfig(content)
      setConfigData(payload)
      setRawContent(content)
      setSavedConfigFingerprint(configFingerprint(content, nextProviders, nextDefault))
      setProviders(nextProviders)
      setDefaultModel(nextDefault)
      setFallbackText((nextDefault.fallbacks ?? []).join('\n'))
      setSelectedProviderKey((current) => current && nextProviders.some((provider) => provider.key === current) ? current : nextProviders[0]?.key ?? '')
      setState('ready')
      toast.success('模型配置已保存')
    } catch (err) {
      setError(err instanceof Error ? err.message : '模型配置保存失败')
      setState('error')
      toast.warning('模型配置保存失败')
    }
  }, [nextConfigContent])

  return (
    <DashboardLayout>
      <div className={error && !configData ? 'flex min-h-[calc(100dvh-8rem)] items-center justify-center' : 'mx-auto flex max-w-7xl flex-col gap-6'}>
        {error && !configData ? (
          <Card className="w-full max-w-md">
            <Card.Content>
              <div className="flex flex-col items-center px-6 py-8 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-danger/10 text-danger">
                  <Icon icon="lucide:circle-alert" className="size-6" />
                </div>
                <h2 className="mt-4 text-lg font-semibold text-foreground">无法加载模型配置</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted">{error}</p>
                <Button className="mt-6" variant={refreshButtonVariant} onPress={loadConfig} isDisabled={state === 'loading'}>
                  <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'animate-spin' : ''} />
                  重新加载
                </Button>
              </div>
            </Card.Content>
          </Card>
        ) : null}

        {error && configData ? (
          <Card>
            <Card.Content>
              <div className="flex items-start gap-3 text-danger">
                <Icon icon="lucide:circle-alert" className="mt-0.5 size-5" />
                <div>
                  <p className="font-medium">模型配置操作失败</p>
                  <p className="mt-1 text-sm text-muted">{error}</p>
                </div>
              </div>
            </Card.Content>
          </Card>
        ) : null}

        {isLoading ? <ModelsSkeleton /> : null}

        {configData ? (
          <>
            <section className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
              <Card variant="transparent" className="h-full overflow-visible">
                <Card.Content className="flex h-full items-center justify-center overflow-visible">
                  <div className="flex w-full flex-row items-center gap-4 overflow-visible md:gap-6">
                    <div className="flex h-36 items-center justify-center shrink-0 overflow-visible p-1">
                      <img src="https://assets.orence.net/file/20260513083922181.png" alt="System Overview" className="h-full w-auto" />
                    </div>
                    <div className="flex min-w-0 flex-col gap-5">
                      <div className="min-w-0">
                        <Card.Title className="md:text-3xl text-2xl font-bold">模型</Card.Title>
                        <Card.Description className="mt-4 md:text-lg text-base">管理 OpenClaw 模型服务商、模型清单、默认主模型与 fallback 链。</Card.Description>


                        <div className="flex items-center gap-4">
                          <Button className="mt-4" variant="primary" onPress={openCreateProviderEditor} isDisabled={isSaving}>
                            <Icon icon="lucide:plus" className="size-4" />
                            添加服务商
                          </Button>

                          {modelInitializationPreset && !hasInitializationProvider ? (
                            <Button className="mt-4" variant="tertiary" onPress={openInitializationProviderEditor} isDisabled={isSaving}>
                              <ProviderLogo providerCatalog={providerCatalog} providerKey={modelInitializationPreset.key} size="sm" />
                              {modelInitializationPreset.name}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>

                </Card.Content>
              </Card>
              <HeroModelSummary
                modelCatalog={modelCatalog}
                primaryModel={primaryModelSummary.model}
                provider={primaryModelSummary.provider}
                providerCatalog={providerCatalog}
                providerCount={stats.providerCount}
                modelCount={stats.modelCount}
              />
            </section>

            {providerEditorOpen ? (
              <>
                <ProviderEditorPanel
                  form={providerForm}
                  addedModels={providerEditorAddedModels}
                  fetchedModels={fetchedProviderModels}
                  hasFetchedModels={hasFetchedProviderModels}
                  isFetchingModels={isFetchingProviderModels}
                  isSaving={isSaving}
                  mode={providerEditorMode}
                  originalProvider={providers.find((provider) => provider.key === providerEditorOriginalKey) ?? null}
                  providerCatalog={providerCatalog}
                  providerPresets={providerPresets}
                  selectableProviderPresets={availableProviderPresets}
                  removedModelIds={removedProviderModelIds}
                  onCancel={() => setProviderEditorOpen(false)}
                  onAddModel={(model) => {
                    const nextModel = withGeneratedModelName(model)
                    setProviderEditorAddedModels((current) => mergeModelsById(current, [nextModel]))
                    setRemovedProviderModelIds((current) => current.filter((modelId) => modelId !== nextModel.id))
                  }}
                  onChange={(patch) => {
                    if ('api' in patch || 'apiKey' in patch || 'baseUrl' in patch || 'contextWindow' in patch || 'maxTokens' in patch) {
                      setFetchedProviderModels([])
                      setHasFetchedProviderModels(false)
                    }
                    setProviderForm((current) => ({ ...current, ...patch }))
                  }}
                  onFetchModels={fetchProviderModels}
                  onClearFetchedModels={clearFetchedProviderModels}
                  onRemoveModel={(modelId) => setRemovedProviderModelIds((current) => current.includes(modelId) ? current : [...current, modelId])}
                  onReplaceModels={(models) => {
                    setProviderEditorReplacementModels(models)
                    setProviderEditorAddedModels([])
                    setRemovedProviderModelIds([])
                  }}
                  onPresetChange={applyProviderPreset}
                  onSubmit={submitProviderForm}
                />
                <div ref={providerEditorScrollAnchorRef} aria-hidden className="h-px" />
              </>
            ) : (
              <section className="flex flex-col gap-4">
                {hasProviders ? (
                  <ProviderSegment
                    providers={filteredProviders}
                    providerCatalog={providerCatalog}
                    query={query}
                    refreshButtonVariant={refreshButtonVariant}
                    selectedKey={selectedProvider?.key ?? ''}
                    state={state}
                    hasUnsavedChanges={hasUnsavedChanges}
                    isSaving={isSaving}
                    onQueryChange={setQuery}
                    onRefresh={loadConfig}
                    onSave={saveConfig}
                    onSelectionChange={(key) => setSelectedProviderKey(String(key))}
                  />
                ) : null}
                {filteredProviders.length ? (
                  <>
                    {selectedProvider ? (
                      <ProviderModelTable
                        provider={selectedProvider}
                        modelCatalog={modelCatalog}
                        providerCatalog={providerCatalog}
                        defaultModel={defaultModel}
                        fallbackText={fallbackText}
                        isSaving={isSaving}
                        onEdit={() => openEditProviderEditor(selectedProvider)}
                        onDelete={() => deleteProvider(selectedProvider.key)}
                        onAddModel={(model) => addModelToProvider(selectedProvider.key, model)}
                        onDeleteModel={(modelId) => deleteModel(selectedProvider.key, modelId)}
                        onSetPrimary={(modelId) => setPrimaryModel(selectedProvider.key, modelId)}
                        onToggleFallback={(modelId) => toggleFallbackModel(selectedProvider.key, modelId)}
                      />
                    ) : null}
                  </>
                ) : hasProviders && hasProviderQuery ? (
                  <EmptyState icon="lucide:search-x" title="没有匹配服务商" description="换一个关键字，或新增 Provider。" />
                ) : (
                  <EmptyState
                    icon="lucide:box"
                    title="还没有模型服务商"
                    description="新增一个 Provider 后，就可以配置模型、主模型和备用模型。"
                    actions={(
                      <div className="mt-4 flex items-center gap-3">
                        <Button size="sm" variant="primary" onPress={openCreateProviderEditor} isDisabled={isSaving}>
                          <Icon icon="lucide:plus" className="size-4" />
                          添加服务商
                        </Button>
                        <Button isIconOnly variant="tertiary" aria-label="重新加载模型配置" size="sm" onPress={loadConfig} isDisabled={state === 'loading'}>
                          <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'size-4 animate-spin' : 'size-4'} />
                        </Button>
                      </div>
                    )}
                  />
                )}
              </section>
            )}
          </>
        ) : null}
      </div>
    </DashboardLayout>
  )
}

function HeroModelSummary({
  modelCatalog,
  modelCount,
  primaryModel,
  provider,
  providerCatalog,
  providerCount,
}: {
  modelCatalog: ModelCatalog
  modelCount: number
  primaryModel?: OpenClawModelDefinition
  provider?: ProviderDraft
  providerCatalog: ProviderCatalog
  providerCount: number
}) {
  const hasPrimaryModel = Boolean(provider && primaryModel)

  return (
    <Card className="h-full">
      <Card.Content>
        <div className="grid gap-3">
          <div className="rounded-2xl bg-surface-secondary/50 p-4">
            <div className="flex items-center gap-3">
              {hasPrimaryModel ? (
                <ModelLogo model={primaryModel as OpenClawModelDefinition} modelCatalog={modelCatalog} providerCatalog={providerCatalog} providerKey={(provider as ProviderDraft).key} size="md" />
              ) : (
                <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-muted">
                  <Icon icon="lucide:route-off" className="size-5" />
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-foreground">
                  {primaryModel?.name || primaryModel?.id || '未设置主模型'}
                </div>
                <div className="truncate font-mono text-xs text-muted">
                  {provider && primaryModel ? `${provider.key}/${primaryModel.id}` : '请选择一个默认主模型'}
                </div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-surface-secondary/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-muted">模型</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{modelCount}</div>
                </div>
                <div className="flex size-10 items-center justify-center rounded-full bg-surface text-muted">
                  <Icon icon="lucide:boxes" className="size-5" />
                </div>
              </div>
            </div>
            <div className="rounded-2xl bg-surface-secondary/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-muted">服务商</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{providerCount}</div>
                </div>
                <div className="flex size-10 items-center justify-center rounded-full bg-surface text-muted">
                  <Icon icon="lucide:cloud-cog" className="size-5" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function ProviderEditorPanel({
  addedModels,
  fetchedModels,
  form,
  hasFetchedModels,
  isFetchingModels,
  isSaving,
  mode,
  originalProvider,
  providerCatalog,
  providerPresets,
  selectableProviderPresets,
  removedModelIds,
  onAddModel,
  onCancel,
  onClearFetchedModels,
  onChange,
  onFetchModels,
  onRemoveModel,
  onReplaceModels,
  onPresetChange,
  onSubmit,
}: {
  addedModels: OpenClawModelDefinition[]
  fetchedModels: OpenClawModelDefinition[] | null
  form: ProviderFormState
  hasFetchedModels: boolean
  isFetchingModels: boolean
  isSaving: boolean
  mode: ProviderEditorMode
  originalProvider: ProviderDraft | null
  providerCatalog: ProviderCatalog
  providerPresets: ProviderPreset[]
  selectableProviderPresets: ProviderPreset[]
  removedModelIds: string[]
  onAddModel: (model: OpenClawModelDefinition) => void
  onCancel: () => void
  onClearFetchedModels: () => void
  onChange: (patch: Partial<ProviderFormState>) => void
  onFetchModels: () => void
  onRemoveModel: (modelId: string) => void
  onReplaceModels: (models: OpenClawModelDefinition[]) => void
  onPresetChange: (presetKey: string) => void
  onSubmit: () => void
}) {
  const selectedPreset = providerPresets.find((preset) => sameProviderKey(preset.key, form.presetKey))
  const providerMatchedPreset = providerPresets.find((preset) => sameProviderKey(preset.key, form.key || originalProvider?.key))
  const displayPreset = selectedPreset ?? providerMatchedPreset
  const [overrideWithPresetModels, setOverrideWithPresetModels] = useState(false)
  const effectiveOriginalModels = overrideWithPresetModels && displayPreset ? displayPreset.models : originalProvider?.models ?? []
  const shouldUsePresetModels = Boolean(selectedPreset && (mode === 'create' || !sameProviderKey(selectedPreset.key, originalProvider?.key) || overrideWithPresetModels))
  const previewModels = mergeModelsById(shouldUsePresetModels ? selectedPreset?.models ?? [] : effectiveOriginalModels, addedModels).filter((model) => !removedModelIds.includes(model.id))
  const canUpdateFromPresetModels = Boolean(displayPreset && !overrideWithPresetModels && !modelsEquivalent(previewModels, displayPreset.models))
  const fetchedCandidateModels = (fetchedModels ?? []).filter((model) => model.id && !previewModels.some((previewModel) => previewModel.id === model.id))
  const previewProviderKey = toSafeProviderKey(form.key) || displayPreset?.key || originalProvider?.key || 'provider'
  const previewProviderName = displayPreset?.name || providerDisplayName(previewProviderKey, providerCatalog)
  const canFetchModels = Boolean(String(form.api ?? '').trim() && form.baseUrl.trim() && form.apiKey.trim())
  const canTestModels = Boolean(String(form.api ?? '').trim() && form.baseUrl.trim() && form.apiKey.trim())
  const [testingModelId, setTestingModelId] = useState('')
  const [testedModelFingerprints, setTestedModelFingerprints] = useState<Record<string, string>>({})
  const [isAddModelOpen, setIsAddModelOpen] = useState(false)
  const [addModelForm, setAddModelForm] = useState<AddModelFormState>(emptyAddModelForm)
  const apiKeyDisplayValue = maskSecretValue(form.apiKey)
  const testFingerprint = `${form.api}\n${form.baseUrl.trim()}\n${form.apiKey.trim()}`
  const currentProviderSnapshot = JSON.stringify(stripEmptyValues({
    api: form.api,
    apiKey: form.apiKey.trim(),
    baseUrl: form.baseUrl.trim(),
    contextWindow: parseOptionalNumber(form.contextWindow),
    maxTokens: parseOptionalNumber(form.maxTokens),
    models: previewModels.map((model) => stripEmptyValues(model)),
    providerKey: toSafeProviderKey(form.key),
  }))
  const originalProviderSnapshot = JSON.stringify(stripEmptyValues({
    api: (originalProvider?.api as OpenClawModelApiType | undefined) ?? emptyProviderForm.api,
    apiKey: typeof originalProvider?.apiKey === 'string' ? originalProvider.apiKey.trim() : '',
    baseUrl: originalProvider?.baseUrl?.trim() ?? '',
    contextWindow: originalProvider?.contextWindow,
    maxTokens: originalProvider?.maxTokens,
    models: (originalProvider?.models ?? []).map((model) => stripEmptyValues(model)),
    providerKey: originalProvider?.key ?? '',
  }))
  const hasCreateProviderDraft = Boolean(
    toSafeProviderKey(form.key)
    || form.api !== emptyProviderForm.api
    || form.apiKey.trim()
    || form.baseUrl.trim()
    || form.contextWindow.trim()
    || form.maxTokens.trim()
    || form.presetKey
    || addedModels.length
    || removedModelIds.length,
  )
  const hasProviderEditorChanges = mode === 'create'
    ? hasCreateProviderDraft
    : currentProviderSnapshot !== originalProviderSnapshot
  const shouldShowSubmitButton = isSaving || hasProviderEditorChanges
  const presetScrollAnchorRef = useRef<HTMLDivElement | null>(null)
  const previousPresetKeyRef = useRef(form.presetKey)
  const previousFetchedModelsStateRef = useRef(hasFetchedModels)

  const testProviderModel = useCallback(async (model: OpenClawModelDefinition) => {
    if (!form.baseUrl.trim()) {
      toast.warning('请先填写 Base URL')
      return
    }
    if (!model.id?.trim()) {
      toast.warning('模型 ID 为空，无法测试')
      return
    }

    setTestingModelId(model.id)
    try {
      const result = await testOpenClawProviderModel({
        api: form.api,
        apiKey: form.apiKey.trim(),
        baseUrl: form.baseUrl.trim(),
        model: model.id.trim(),
      })
      if (result.ok) {
        setTestedModelFingerprints((current) => ({ ...current, [model.id]: testFingerprint }))
        toast.success(`${model.name || model.id} 连通正常（${result.durationMs}ms）`)
      } else {
        setTestedModelFingerprints((current) => {
          const { [model.id]: _removed, ...next } = current
          void _removed
          return next
        })
        toast.warning(result.message || '模型连通性测试失败')
      }
    } catch (err) {
      setTestedModelFingerprints((current) => {
        const { [model.id]: _removed, ...next } = current
        void _removed
        return next
      })
      toast.warning(err instanceof Error ? err.message : '模型连通性测试失败')
    } finally {
      setTestingModelId('')
    }
  }, [form.api, form.apiKey, form.baseUrl, testFingerprint])

  useEffect(() => {
    setOverrideWithPresetModels(false)
  }, [displayPreset?.key, form.presetKey, originalProvider?.key])

  useEffect(() => {
    const previousPresetKey = previousPresetKeyRef.current
    previousPresetKeyRef.current = form.presetKey

    if (previousPresetKey === form.presetKey) return

    const frame = window.requestAnimationFrame(() => {
      presetScrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [form.presetKey])

  useEffect(() => {
    const previousFetchedModelsState = previousFetchedModelsStateRef.current
    previousFetchedModelsStateRef.current = hasFetchedModels

    if (previousFetchedModelsState === hasFetchedModels) return

    const frame = window.requestAnimationFrame(() => {
      presetScrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [hasFetchedModels])

  function closeAddModelDialog() {
    setIsAddModelOpen(false)
    setAddModelForm(emptyAddModelForm)
  }

  function submitAddModel() {
    const id = addModelForm.id.trim()
    if (!id) {
      toast.warning('请输入模型 ID')
      return
    }
    if (previewModels.some((model) => model.id === id)) {
      toast.warning('模型 ID 已存在')
      return
    }

    onAddModel(enrichModelContext({
      contextWindow: parseOptionalNumber(addModelForm.contextWindow),
      id,
      input: ['text'],
      name: addModelForm.name.trim() || titleizeModelId(id),
      reasoning: addModelForm.reasoning || undefined,
    }))
    closeAddModelDialog()
  }

  return (
    <>

      <div className="flex flex-col gap-4">
        <div className="flex justify-between items-center gap-3 bg-[var(--surface)] rounded-2xl p-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-soft-foreground">
              <Icon icon={mode === 'create' ? 'lucide:plus' : 'lucide:pencil'} className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="text-base font-medium text-foreground">{mode === 'create' ? '新增服务商' : '编辑服务商'}</div>
              <div className="text-xs text-muted">配置模型 Provider 基础连接信息。</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {shouldShowSubmitButton ? (
              <Button size="sm" variant="primary" onPress={onSubmit} isDisabled={isSaving || !form.key.trim()}>
                <Icon icon={isSaving ? 'lucide:loader-circle' : 'lucide:save'} className={isSaving ? 'animate-spin' : 'size-4'} />
                {mode === 'create' ? '创建' : '保存'}
              </Button>
            ) : null}
            <Button isIconOnly aria-label="关闭服务商编辑" size="sm" variant="primary" onPress={onCancel} isDisabled={isSaving}>
              <Icon icon="lucide:x" className="size-4" />
            </Button>
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-[minmax(520px,520px)_minmax(0,1fr)]">
          <div className="h-fit flex flex-col gap-2">
            <div className="overflow-hidden">
              <ItemCardGroup className="overflow-hidden">
                <FragmentWithSeparator showSeparator={false}>
                  <ProviderFormItem actionClassName="w-fit max-w-full" description="选择后会带入预设信息" icon="lucide:wand-sparkles" title="预设模板">
                    <ProviderPresetSelect
                      className="w-fit max-w-full"
                      presets={selectableProviderPresets}
                      providerCatalog={providerCatalog}
                      value={form.presetKey || manualPresetKey}
                      onChange={(value) => onPresetChange(value === manualPresetKey ? '' : String(value ?? ''))}
                    />
                  </ProviderFormItem>
                </FragmentWithSeparator>
                <FragmentWithSeparator showSeparator>
                  <ProviderFormItem actionClassName="w-fit max-w-full" description="OpenClaw 请求适配器" icon="lucide:route" title="API 类型">
                    <ProviderCellSelect
                      ariaLabel="API 类型"
                      className="w-fit max-w-full"
                      icon="lucide:route"
                      isDisabled={isSaving}
                      label="API 类型"
                      value={form.api}
                      onChange={(value) => onChange({ api: String(value ?? 'openai-completions') as OpenClawModelApiType })}
                    >
                      {apiTypeOptions.map((apiType) => (
                        <ListBox.Item key={apiType} id={apiType} textValue={apiType}>
                          {apiType}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ProviderCellSelect>
                  </ProviderFormItem>
                </FragmentWithSeparator>
                <FragmentWithSeparator showSeparator>
                  <ProviderFormItem description="用于 provider/model 引用" icon="lucide:fingerprint" title="Provider ID">
                    <ProviderFormField ariaLabel="Provider ID">
                      <InputGroup.Input value={form.key} disabled={isSaving} placeholder="openai" onChange={(event) => onChange({ key: event.target.value })} />
                    </ProviderFormField>
                  </ProviderFormItem>
                </FragmentWithSeparator>
                <FragmentWithSeparator showSeparator>
                  <ProviderFormItem description="模型服务接口地址" icon="lucide:link" title="Base URL">
                    <ProviderFormField ariaLabel="Base URL">
                      <InputGroup.Input value={form.baseUrl} disabled={isSaving} placeholder="https://api.example.com/v1" onChange={(event) => onChange({ baseUrl: event.target.value })} />
                    </ProviderFormField>
                  </ProviderFormItem>
                </FragmentWithSeparator>
                <FragmentWithSeparator showSeparator>
                  <ProviderFormItem description="输入内容自动脱敏" icon="lucide:key-round" title="API Key">
                    <ProviderFormField ariaLabel="API Key">
                      <InputGroup.Input
                        value={apiKeyDisplayValue}
                        disabled={isSaving}
                        placeholder="sk-..."
                        onChange={(event) => onChange({ apiKey: event.target.value })}
                      />
                    </ProviderFormField>
                  </ProviderFormItem>
                </FragmentWithSeparator>
                <FragmentWithSeparator showSeparator>
                  <ProviderFormItem description="Provider 默认上下文窗口" icon="lucide:braces" title="Context Window">
                    <ProviderFormField ariaLabel="Context Window">
                      <InputGroup.Input value={form.contextWindow} disabled={isSaving} placeholder="例如 128000" onChange={(event) => onChange({ contextWindow: event.target.value })} />
                    </ProviderFormField>
                  </ProviderFormItem>
                </FragmentWithSeparator>
                <FragmentWithSeparator showSeparator>
                  <ProviderFormItem description="Provider 默认输出上限" icon="lucide:hash" title="Max Tokens">
                    <ProviderFormField ariaLabel="Max Tokens">
                      <InputGroup.Input value={form.maxTokens} disabled={isSaving} placeholder="例如 8192" onChange={(event) => onChange({ maxTokens: event.target.value })} />
                    </ProviderFormField>
                  </ProviderFormItem>
                </FragmentWithSeparator>
              </ItemCardGroup>

              {displayPreset?.docsUrl || displayPreset?.apiKeyUrl || displayPreset?.buttons?.length || canUpdateFromPresetModels ? (
                <ItemCardGroup className="mt-4 overflow-hidden">
                  {displayPreset?.docsUrl ? (
                    <FragmentWithSeparator showSeparator={false}>
                      <ProviderLinkItem
                        description="打开服务商模型与接口文档。"
                        icon="lucide:book-open"
                        label="文档"
                        onPress={() => openExternalUrl(displayPreset.docsUrl)}
                      />
                    </FragmentWithSeparator>
                  ) : null}
                  {displayPreset?.apiKeyUrl ? (
                    <FragmentWithSeparator showSeparator={Boolean(displayPreset?.docsUrl)}>
                      <ProviderLinkItem
                        description="打开服务商控制台 API Key 页面。"
                        icon="lucide:key-round"
                        label="获取 API Key"
                        onPress={() => openExternalUrl(displayPreset.apiKeyUrl)}
                      />
                    </FragmentWithSeparator>
                  ) : null}
                  {displayPreset?.buttons?.map((button, index) => (
                    <FragmentWithSeparator key={`${button.label}-${button.link}`} showSeparator={Boolean(displayPreset.docsUrl || displayPreset.apiKeyUrl || index > 0)}>
                      <ProviderLinkItem
                        description={displayPreset.description || `打开 ${displayPreset.name} 相关页面。`}
                        icon="lucide:globe"
                        label={button.label}
                        onPress={() => openExternalUrl(button.link)}
                      />
                    </FragmentWithSeparator>
                  ))}
                  {canUpdateFromPresetModels && displayPreset ? (
                    <FragmentWithSeparator showSeparator={Boolean(displayPreset?.docsUrl || displayPreset?.apiKeyUrl || displayPreset?.buttons?.length)}>
                      <ProviderActionItem
                        description="远程模型存在更新，点击后用远程模型覆盖当前已添加模型。"
                        icon="lucide:refresh-cw"
                        label="更新本地模型"
                        actionIcon="lucide:refresh-cw"
                        actionLabel="更新"
                        onPress={() => {
                          setOverrideWithPresetModels(true)
                          onReplaceModels(displayPreset.models.map((model) => ({ ...model })))
                        }}
                      />
                    </FragmentWithSeparator>
                  ) : null}
                </ItemCardGroup>
              ) : null}
            </div>
          </div>

          <Card className="flex max-h-[calc(100vh-200px)] min-h-0 min-w-0 flex-col self-start">
            <Card.Header className="flex-row items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <ProviderLogo icon={displayPreset?.icon} providerCatalog={providerCatalog} providerKey={displayPreset?.key || previewProviderKey} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Card.Title className="truncate">{previewProviderName}</Card.Title>
                    <Chip size="sm" variant="soft">{previewModels.length} 模型</Chip>
                  </div>
                  <Card.Description className="truncate">{form.baseUrl || '未配置 Base URL'}</Card.Description>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {canFetchModels || hasFetchedModels ? (
                  <Button
                    size="sm"
                    variant="tertiary"
                    onPress={hasFetchedModels ? onClearFetchedModels : onFetchModels}
                    isDisabled={isSaving || isFetchingModels}
                  >
                    <Icon icon={isFetchingModels ? 'lucide:loader-circle' : hasFetchedModels ? 'lucide:x' : 'lucide:download-cloud'} className={isFetchingModels ? 'animate-spin' : 'size-4'} />
                    {hasFetchedModels ? '清除' : '获取模型列表'}
                  </Button>
                ) : null}
                <Button size="sm" variant="tertiary" onPress={() => setIsAddModelOpen(true)} isDisabled={isSaving}>
                  <Icon icon="lucide:plus" className="size-4" />
                  添加模型
                </Button>
              </div>
            </Card.Header>
            <Card.Content className="min-h-0 flex-1">
              <div className={hasFetchedModels ? 'grid h-full min-h-0 items-stretch gap-3 lg:grid-cols-2' : 'grid h-full min-h-0 gap-3'}>
                <div className="flex min-h-0 min-w-0 flex-col">
                  <div className="mb-2 shrink-0 text-sm font-medium text-foreground">已添加模型</div>
                  {previewModels.length ? (
                    <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto">
                      {previewModels.map((model, index) => (
                        <ModelPreviewItem
                          key={`${model.id}-${index}`}
                          action={(
                            <>
                              {!hasFetchedModels && canTestModels ? (
                                <Button
                                  isIconOnly
                                  aria-label="测试模型连通性"
                                  size="sm"
                                  variant="tertiary"
                                  className={testedModelFingerprints[model.id] === testFingerprint ? 'bg-success text-success-foreground hover:bg-success/90' : undefined}
                                  onPress={() => testProviderModel(model)}
                                  isDisabled={isSaving || Boolean(testingModelId) || !model.id}
                                >
                                  <Icon icon={testingModelId === model.id ? 'lucide:loader-circle' : testedModelFingerprints[model.id] === testFingerprint ? 'lucide:check' : 'lucide:plug-zap'} className={testingModelId === model.id ? 'size-4 animate-spin' : 'size-4'} />
                                </Button>
                              ) : null}
                              <Button isIconOnly aria-label="移除模型" size="sm" variant="ghost" onPress={() => onRemoveModel(model.id)} isDisabled={isSaving || !model.id}>
                                <Icon icon="lucide:trash-2" className="size-4" />
                              </Button>
                            </>
                          )}
                          model={model}
                        />
                      ))}
                    </div>
                  ) : (
                    <EmptyState icon="lucide:boxes" title="暂无模型列表" description="选择带模型的预设，或从右侧获取结果中添加模型。" />
                  )}
                </div>
                {hasFetchedModels ? (
                  <div className="flex min-h-0 min-w-0 flex-col">
                    <div className="mb-2 shrink-0 text-sm font-medium text-foreground">获取结果</div>
                    {fetchedCandidateModels.length ? (
                      <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto">
                        {fetchedCandidateModels.map((model, index) => (
                          <ModelPreviewItem
                            key={`${model.id}-${index}`}
                            action={(
                              <Button isIconOnly aria-label="添加模型" size="sm" variant="ghost" onPress={() => onAddModel(model)} isDisabled={isSaving || !model.id}>
                                <Icon icon="lucide:plus" className="size-4" />
                              </Button>
                            )}
                            model={model}
                          />
                        ))}
                      </div>
                    ) : (
                      <EmptyState icon="lucide:download-cloud" title="暂无可添加模型" description="获取结果已和已添加模型去重，没有新的模型可添加。" />
                    )}
                  </div>
                ) : null}
              </div>
            </Card.Content>
          </Card>
        </div>
      </div >
      <ModelAddDialog
        description={`为 ${previewProviderName} 添加一个可路由模型。`}
        form={addModelForm}
        isOpen={isAddModelOpen}
        onCancel={closeAddModelDialog}
        onSubmit={submitAddModel}
        onChange={setAddModelForm}
        title="添加模型"
      />
      <div ref={presetScrollAnchorRef} aria-hidden className="h-px" />
    </>
  )
}

function ModelPreviewItem({
  action,
  model,
}: {
  action: React.ReactNode
  model: OpenClawModelDefinition
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl bg-surface-secondary/50 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{model.name || model.id || 'unnamed-model'}</p>
        {model.id && model.name !== model.id ? <p className="mt-0.5 truncate font-mono text-xs text-muted">{model.id}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {model.reasoning ? (
          <span className="flex size-7 items-center justify-center rounded-full bg-surface text-muted" title="Reasoning">
            <Icon icon="lucide:brain-circuit" className="size-4" />
          </span>
        ) : null}
        {model.input?.includes('image') ? (
          <span className="flex size-7 items-center justify-center rounded-full bg-surface text-muted" title="Vision">
            <Icon icon="lucide:eye" className="size-4" />
          </span>
        ) : null}
        {action}
      </div>
    </div>
  )
}

function ModelAbilityIcons({ model }: { model: OpenClawModelDefinition }) {
  const supportsText = !model.input?.length || model.input.includes('text')
  const abilities = [
    supportsText ? { icon: 'lucide:file-text', label: 'Text' } : null,
    model.reasoning ? { icon: 'lucide:brain-circuit', label: 'Reasoning' } : null,
    model.input?.includes('image') ? { icon: 'lucide:eye', label: 'Vision' } : null,
  ].filter(Boolean) as Array<{ icon: string; label: string }>

  return (
    <div className="flex flex-wrap gap-1.5">
      {abilities.length ? abilities.map((ability) => (
        <span
          key={ability.label}
          aria-label={ability.label}
          className="flex size-7 items-center justify-center rounded-full bg-surface-secondary/50 text-muted"
          title={ability.label}
        >
          <Icon icon={ability.icon} className="size-4" />
        </span>
      )) : (
        <span className="flex size-7 items-center justify-center rounded-full bg-surface-secondary/50 text-muted" title="Text" aria-label="Text">
          <Icon icon="lucide:file-text" className="size-4" />
        </span>
      )}
    </div>
  )
}

function ProviderFormItem({
  actionClassName = 'w-full min-w-0 sm:w-64',
  children,
  description,
  icon,
  title,
}: {
  actionClassName?: string
  children: React.ReactNode
  description: string
  icon: string
  title: string
}) {
  return (
    <ItemCard>
      <ItemCard.Icon className="size-10 rounded-full bg-surface-secondary/50 text-muted">
        <Icon icon={icon} className="size-5" />
      </ItemCard.Icon>
      <ItemCard.Content>
        <ItemCard.Title>{title}</ItemCard.Title>
        <ItemCard.Description>{description}</ItemCard.Description>
      </ItemCard.Content>
      <ItemCard.Action>
        <div className={actionClassName}>
          {children}
        </div>
      </ItemCard.Action>
    </ItemCard>
  )
}

function ProviderLinkItem({
  description,
  icon,
  label,
  onPress,
}: {
  description: string
  icon: string
  label: string
  onPress: () => void
}) {
  return (
    <ProviderActionItem
      actionIcon="lucide:external-link"
      actionLabel="打开"
      description={description}
      icon={icon}
      label={label}
      onPress={onPress}
    />
  )
}

function ProviderActionItem({
  actionIcon,
  actionLabel,
  description,
  icon,
  label,
  onPress,
}: {
  actionIcon?: string
  actionLabel: string
  description: string
  icon: string
  label: string
  onPress: () => void
}) {
  return (
    <ItemCard>
      <ItemCard.Icon className="size-10 rounded-full bg-surface-secondary/50 text-muted">
        <Icon icon={icon} className="size-5" />
      </ItemCard.Icon>
      <ItemCard.Content>
        <ItemCard.Title>{label}</ItemCard.Title>
        <ItemCard.Description>{description}</ItemCard.Description>
      </ItemCard.Content>
      <ItemCard.Action>
        <Button size="sm" variant="tertiary" onPress={onPress}>
          {actionIcon ? <Icon icon={actionIcon} className="size-4" /> : null}
          {actionLabel}
        </Button>
      </ItemCard.Action>
    </ItemCard>
  )
}

function FragmentWithSeparator({ children, showSeparator }: { children: React.ReactNode; showSeparator: boolean }) {
  return (
    <>
      {showSeparator ? <Separator /> : null}
      {children}
    </>
  )
}

function ProviderPresetSelect({
  className = 'w-full',
  onChange,
  presets,
  providerCatalog,
  value,
}: {
  className?: string
  onChange: (value: Key | null) => void
  presets: ProviderPreset[]
  providerCatalog: ProviderCatalog
  value: Key | null
}) {
  const selectedKey = String(value ?? manualPresetKey)
  const selectedPreset = presets.find((preset) => sameProviderKey(preset.key, selectedKey))

  return (
    <CellSelect aria-label="预设模板" className={className} value={value} variant="secondary" onChange={onChange}>
      <CellSelect.Trigger>
        <CellSelect.Value>
          {() => selectedPreset ? (
            <span className="flex min-w-0 items-center justify-end gap-2 text-end">
              <ProviderLogo icon={selectedPreset.icon} providerCatalog={providerCatalog} providerKey={selectedPreset.key} size="sm" />
              <span className="truncate font-semibold">{selectedPreset.name}</span>
              {/* <span className="text-xs text-muted">{selectedPreset.models.length}</span> */}
            </span>
          ) : (
            <span className="text-muted">手动配置</span>
          )}
        </CellSelect.Value>
        <CellSelect.Indicator />
      </CellSelect.Trigger>
      <CellSelect.Popover>
        <ListBox>
          <ListBox.Item id={manualPresetKey} textValue="手动配置">
            <Icon icon="lucide:wrench" className="size-4 text-muted" />
            手动配置
            <ListBox.ItemIndicator />
          </ListBox.Item>
          {presets.map((preset) => (
            <ListBox.Item key={preset.key} id={preset.key} textValue={preset.name}>
              <ProviderLogo icon={preset.icon} providerCatalog={providerCatalog} providerKey={preset.key} size="sm" />
              <span className="min-w-0 flex-1 truncate">{preset.name}</span>
              <span className="text-xs text-muted">{preset.models.length} 模型</span>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </CellSelect.Popover>
    </CellSelect>
  )
}

function ProviderCellSelect({
  ariaLabel,
  children,
  className = 'w-full',
  icon,
  isDisabled,
  label,
  onChange,
  value,
}: {
  ariaLabel: string
  children: React.ReactNode
  className?: string
  icon: string
  isDisabled?: boolean
  label: string
  onChange: (value: Key | null) => void
  value: Key | null
}) {
  return (
    <CellSelect aria-label={ariaLabel} className={className} isDisabled={isDisabled} value={value} variant="secondary" onChange={onChange}>
      <CellSelect.Trigger>
        {value ? null : (
          <CellSelect.Label>
            <span className="flex items-center gap-2">
              <Icon icon={icon} className="size-4 text-muted" />
              {label}
            </span>
          </CellSelect.Label>
        )}
        <CellSelect.Value />
        <CellSelect.Indicator />
      </CellSelect.Trigger>
      <CellSelect.Popover>
        <ListBox>
          {children}
        </ListBox>
      </CellSelect.Popover>
    </CellSelect>
  )
}

function ProviderFormField({
  ariaLabel,
  children,
}: {
  ariaLabel: string
  children: React.ReactNode
}) {
  return (
    <TextField aria-label={ariaLabel} fullWidth>
      <InputGroup fullWidth variant="secondary">
        {children}
      </InputGroup>
    </TextField>
  )
}

function ProviderLogo({
  icon,
  providerCatalog = [],
  providerKey,
  size = 'md',
}: {
  icon?: string
  providerCatalog?: ProviderCatalog
  providerKey: string
  size?: 'sm' | 'md'
}) {
  const src = providerLogoSrc(providerKey, providerCatalog, icon)
  const boxClassName = size === 'sm' ? 'size-7 rounded-full' : 'size-11 rounded-full'
  const iconClassName = size === 'sm' ? 'size-4' : 'size-5'
  const imageClassName = size === 'sm' ? 'size-5 object-contain' : 'size-7 object-contain'

  return (
    <LogoImage
      alt={providerKey}
      boxClassName={`bg-background ${boxClassName}`}
      fallbackIcon="lucide:cloud-cog"
      iconClassName={iconClassName}
      imageClassName={imageClassName}
      src={src}
    />
  )
}

function ModelLogo({
  model,
  modelCatalog,
  providerCatalog,
  providerKey,
  size = 'sm',
}: {
  model: OpenClawModelDefinition
  modelCatalog: ModelCatalog
  providerCatalog: ProviderCatalog
  providerKey: string
  size?: 'sm' | 'md'
}) {
  const src = modelLogoSrc(model, providerKey, modelCatalog, providerCatalog)
  const boxClassName = size === 'sm' ? 'size-7 rounded-full' : 'size-11 rounded-2xl'
  const iconClassName = size === 'sm' ? 'size-4' : 'size-5'
  const imageClassName = size === 'sm' ? 'size-5 object-contain' : 'size-7 object-contain'

  return (
    <LogoImage
      alt={model.name || model.id || providerKey}
      boxClassName={`bg-background ${boxClassName}`}
      fallbackIcon="lucide:box"
      iconClassName={iconClassName}
      imageClassName={imageClassName}
      src={src}
    />
  )
}

function LogoImage({
  alt,
  boxClassName,
  fallbackIcon,
  iconClassName,
  imageClassName,
  src,
}: {
  alt: string
  boxClassName: string
  fallbackIcon: string
  iconClassName: string
  imageClassName: string
  src?: string
}) {
  const [failed, setFailed] = useState(false)

  return (
    <div className={`flex shrink-0 items-center justify-center overflow-hidden border border-divider ${boxClassName}`}>
      {!src || failed ? (
        <Icon icon={fallbackIcon} className={`${iconClassName} text-muted`} />
      ) : (
        <img src={src} alt={alt} className={imageClassName} draggable={false} onError={() => setFailed(true)} />
      )}
    </div>
  )
}

function ProviderSegment({
  providerCatalog,
  providers,
  query,
  refreshButtonVariant,
  selectedKey,
  state,
  hasUnsavedChanges,
  isSaving,
  onQueryChange,
  onRefresh,
  onSave,
  onSelectionChange,
}: {
  providerCatalog: ProviderCatalog
  providers: ProviderDraft[]
  query: string
  refreshButtonVariant: 'danger' | 'primary' | 'ghost'
  selectedKey: string
  state: LoadState
  hasUnsavedChanges: boolean
  isSaving: boolean
  onQueryChange: (value: string) => void
  onRefresh: () => void
  onSave: () => void
  onSelectionChange: (key: string | number) => void
}) {
  return (
    <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
        {providers.map((provider) => {
          const isSelected = selectedKey === provider.key
          const label = providerDisplayName(provider.key, providerCatalog)

          return isSelected ? (
            <Button
              key={provider.key}
              aria-pressed
              className="shrink-0 pl-1 pr-3 py-1 h-auto"
              size="sm"
              variant="primary"
              onPress={() => onSelectionChange(provider.key)}
            >
              <ProviderLogo providerCatalog={providerCatalog} providerKey={provider.key} size="sm" />
              <span className="max-w-36 truncate">{label}</span>
            </Button>
          ) : (
            <Button
              key={provider.key}
              isIconOnly
              aria-label={label}
              className="shrink-0 p-1 h-auto w-auto"
              size="sm"
              variant="tertiary"
              onPress={() => onSelectionChange(provider.key)}
            >
              <ProviderLogo providerCatalog={providerCatalog} providerKey={provider.key} size="sm" />
            </Button>
          )
        })}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchField variant="primary" className="sm:w-48" aria-label="搜索模型服务商" value={query} onChange={onQueryChange}>
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="搜索..." />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        {hasUnsavedChanges || isSaving ? (
          <Button variant="primary" onPress={onSave} isDisabled={isSaving}>
            <Icon icon={isSaving ? 'lucide:loader-circle' : 'lucide:save'} className={isSaving ? 'animate-spin' : 'size-4'} />
            保存
          </Button>
        ) : null}
        <Button isIconOnly variant={refreshButtonVariant} onPress={onRefresh} isDisabled={state === 'loading' || isSaving} aria-label="刷新模型配置">
          <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'animate-spin' : ''} />
        </Button>
      </div>
    </section>
  )
}

function ProviderModelTable({
  provider,
  modelCatalog,
  providerCatalog,
  defaultModel,
  fallbackText,
  isSaving,
  onEdit,
  onDelete,
  onAddModel,
  onDeleteModel,
  onSetPrimary,
  onToggleFallback,
}: {
  provider: ProviderDraft
  modelCatalog: ModelCatalog
  providerCatalog: ProviderCatalog
  defaultModel: OpenClawDefaultModelConfig
  fallbackText: string
  isSaving: boolean
  onEdit: () => void
  onDelete: () => void
  onAddModel: (model: OpenClawModelDefinition) => void
  onDeleteModel: (modelId: string) => void
  onSetPrimary: (modelId: string) => void
  onToggleFallback: (modelId: string) => void
}) {
  const fallbacks = parseModelLines(fallbackText)
  const models = useMemo(() => {
    const modelRef = defaultModel.primary
    return [...(provider.models ?? [])].sort((left, right) => {
      const leftIsPrimary = modelRef === `${provider.key}/${left.id}`
      const rightIsPrimary = modelRef === `${provider.key}/${right.id}`
      if (leftIsPrimary === rightIsPrimary) return 0
      return leftIsPrimary ? -1 : 1
    })
  }, [defaultModel.primary, provider.key, provider.models])
  const [isAddModelOpen, setIsAddModelOpen] = useState(false)
  const [isDeleteProviderOpen, setIsDeleteProviderOpen] = useState(false)
  const [addModelForm, setAddModelForm] = useState<AddModelFormState>(emptyAddModelForm)

  function closeAddModelDialog() {
    setIsAddModelOpen(false)
    setAddModelForm(emptyAddModelForm)
  }

  function submitAddModel() {
    const id = addModelForm.id.trim()
    if (!id) {
      toast.warning('请输入模型 ID')
      return
    }
    if (models.some((model) => model.id === id)) {
      toast.warning('模型 ID 已存在')
      return
    }

    onAddModel(enrichModelContext({
      contextWindow: parseOptionalNumber(addModelForm.contextWindow),
      id,
      input: ['text'],
      name: addModelForm.name.trim() || titleizeModelId(id),
      reasoning: addModelForm.reasoning || undefined,
    }))
    closeAddModelDialog()
  }

  return (
    <>
      <Card>
        <Card.Header className="flex-row items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3 text-left">
            <ProviderLogo providerCatalog={providerCatalog} providerKey={provider.key} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Card.Title className="truncate">{providerDisplayName(provider.key, providerCatalog)}</Card.Title>
                <Chip size="sm" variant="soft">{models.length} 模型</Chip>
                {provider.api ? <Chip size="sm" variant="soft">{provider.api}</Chip> : null}
              </div>
              <Card.Description className="truncate">{provider.baseUrl || '未配置 Base URL'}</Card.Description>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="tertiary" onPress={onEdit} isDisabled={isSaving} aria-label="编辑服务商">
              <Icon icon="lucide:pencil" className="size-4" />
              编辑
            </Button>
            <Button size="sm" variant="tertiary" onPress={() => setIsAddModelOpen(true)} isDisabled={isSaving}>
              <Icon icon="lucide:plus" className="size-4" />
              添加
            </Button>
            <Button size="sm" variant="danger" isIconOnly onPress={() => setIsDeleteProviderOpen(true)} isDisabled={isSaving} aria-label="删除服务商">
              <Icon icon="lucide:trash-2" className="size-4" />
            </Button>
          </div>
        </Card.Header>
        <Card.Content>
          <div className="flex flex-col gap-4">
            {models.length ? (
              <div className="overflow-x-auto rounded-2xl">
                <table className="min-w-[880px] w-full text-left text-sm">
                  <thead className="bg-background text-xs text-muted">
                    <tr>
                      <th className="px-4 py-3 font-medium">模型</th>
                      <th className="px-4 py-3 font-medium">能力</th>
                      <th className="px-4 py-3 font-medium">上下文</th>
                      <th className="px-4 py-3 font-medium">路由</th>
                      <th className="px-4 py-3 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-divider">
                    {models.map((model, index) => {
                      const modelRef = `${provider.key}/${model.id}`
                      const isPrimary = defaultModel.primary === modelRef
                      const isFallback = fallbacks.includes(modelRef)
                      return (
                        <tr key={`${model.id}-${index}`} className="bg-background align-middle">
                          <td className="px-4 py-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <ModelLogo model={model} modelCatalog={modelCatalog} providerCatalog={providerCatalog} providerKey={provider.key} size="sm" />
                              <div className="min-w-0">
                                <p className="truncate font-semibold text-foreground">{model.name || model.id || 'unnamed-model'}</p>
                                {model.id && model.name !== model.id ? <p className="mt-1 truncate font-mono text-xs text-muted">{model.id}</p> : null}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <ModelAbilityIcons model={model} />
                          </td>
                          <td className="px-4 py-3 text-sm text-muted">{formatContextWindow(model.contextWindow ?? model.contextTokens) || '-'}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1.5">
                              {isPrimary ? <Chip size="sm" variant="primary">主模型</Chip> : null}
                              {!isPrimary && isFallback ? <Chip size="sm" variant="soft">Fallback</Chip> : null}
                              {!isPrimary && !isFallback ? <span className="text-xs text-muted">未加入默认路由</span> : null}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-1">
                              {!isPrimary ? (
                                <Tooltip delay={300}>
                                  <Button isIconOnly size="sm" variant="tertiary" aria-label="设为主模型" onPress={() => onSetPrimary(model.id)} isDisabled={isSaving || !model.id}>
                                    <Icon icon="lucide:brain" className="size-4" />
                                  </Button>
                                  <Tooltip.Content>{model.id ? '设为主模型' : '模型 ID 为空'}</Tooltip.Content>
                                </Tooltip>
                              ) : null}
                              <Tooltip delay={300}>
                                <Button isIconOnly size="sm" variant="tertiary" aria-label={isFallback ? '移出 Fallback' : '加入 Fallback'} onPress={() => onToggleFallback(model.id)} isDisabled={isSaving || isPrimary || !model.id}>
                                  <Icon icon={isFallback ? 'lucide:circle-slash' : 'lucide:circle-fading-arrow-up'} className="size-4" />
                                </Button>
                                <Tooltip.Content>{!model.id ? '模型 ID 为空' : isPrimary ? '主模型不可设为 Fallback' : isFallback ? '移出 Fallback' : '加入 Fallback'}</Tooltip.Content>
                              </Tooltip>
                              <Tooltip delay={300}>
                                <Button size="sm" variant="ghost" isIconOnly onPress={() => onDeleteModel(model.id)} isDisabled={isSaving || !model.id} aria-label="删除模型">
                                  <Icon icon="lucide:trash-2" className="size-4" />
                                </Button>
                                <Tooltip.Content>{model.id ? '删除模型' : '模型 ID 为空'}</Tooltip.Content>
                              </Tooltip>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}

            {!models.length ? (
              <EmptyState icon="lucide:box" title="还没有模型" description="添加模型 ID 后，可在默认模型中引用 provider/model。" />
            ) : null}
          </div>
        </Card.Content>
      </Card>
      <ModelAddDialog
        description={`为 ${providerDisplayName(provider.key, providerCatalog)} 添加一个可路由模型。`}
        form={addModelForm}
        isOpen={isAddModelOpen}
        onCancel={closeAddModelDialog}
        onSubmit={submitAddModel}
        onChange={setAddModelForm}
        title="添加模型"
      />
      <AlertDialog.Backdrop isOpen={isDeleteProviderOpen} onOpenChange={(open) => setIsDeleteProviderOpen(open)}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[420px]">
            <AlertDialog.CloseTrigger />
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>删除这个模型分组？</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>
                将删除
                {' '}
                <span className="font-medium text-foreground">{providerDisplayName(provider.key, providerCatalog)}</span>
                {' '}
                及其 {models.length} 个模型，并从默认路由中移除相关引用。
              </p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button variant="tertiary" onPress={() => setIsDeleteProviderOpen(false)}>取消</Button>
              <Button
                variant="danger"
                onPress={() => {
                  setIsDeleteProviderOpen(false)
                  onDelete()
                }}
                isDisabled={isSaving}
              >
                删除
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  )
}

function ModelAddDialog({
  description,
  form,
  isOpen,
  onCancel,
  onChange,
  onSubmit,
  title,
}: {
  description: string
  form: AddModelFormState
  isOpen: boolean
  onCancel: () => void
  onChange: React.Dispatch<React.SetStateAction<AddModelFormState>>
  onSubmit: () => void
  title: string
}) {
  return (
    <AlertDialog.Backdrop isOpen={isOpen} onOpenChange={(open) => {
      if (!open) onCancel()
    }}>
      <AlertDialog.Container>
        <AlertDialog.Dialog className="sm:max-w-[520px]">
          <AlertDialog.CloseTrigger />
          <AlertDialog.Header>
            <AlertDialog.Heading>{title}</AlertDialog.Heading>
            <p className="text-sm text-muted">{description}</p>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <Card>
              <div className="space-y-4">
                <TextField fullWidth name="model-id">
                  <Label>模型 ID</Label>
                  <InputGroup fullWidth variant="secondary">
                    <InputGroup.Prefix>
                      <Icon icon="lucide:fingerprint" className="size-4 text-muted" />
                    </InputGroup.Prefix>
                    <InputGroup.Input
                      autoFocus
                      placeholder="gpt-4.1-mini"
                      value={form.id}
                      onChange={(event) => onChange((current) => ({ ...current, id: event.target.value }))}
                    />
                  </InputGroup>
                </TextField>
                <TextField fullWidth name="model-name">
                  <Label>模型名称</Label>
                  <InputGroup fullWidth variant="secondary">
                    <InputGroup.Prefix>
                      <Icon icon="lucide:tag" className="size-4 text-muted" />
                    </InputGroup.Prefix>
                    <InputGroup.Input
                      placeholder="GPT 4.1 Mini"
                      value={form.name}
                      onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))}
                    />
                  </InputGroup>
                </TextField>
                <TextField fullWidth name="model-context-window">
                  <Label>上下文长度（选填）</Label>
                  <InputGroup fullWidth variant="secondary">
                    <InputGroup.Prefix>
                      <Icon icon="lucide:braces" className="size-4 text-muted" />
                    </InputGroup.Prefix>
                    <InputGroup.Input
                      inputMode="numeric"
                      placeholder="例如 128000"
                      value={form.contextWindow}
                      onChange={(event) => onChange((current) => ({ ...current, contextWindow: event.target.value }))}
                    />
                  </InputGroup>
                </TextField>
                <div className="flex items-center justify-between gap-4 rounded-2xl bg-surface-tertiary border border-divider px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">推理模型</div>
                    <div className="mt-1 text-xs text-muted">推理模型会使用特殊的调用方式。</div>
                  </div>
                  <Switch size="lg" aria-label="推理模型" isSelected={form.reasoning} onChange={(isSelected) => onChange((current) => ({ ...current, reasoning: isSelected }))}>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                  </Switch>
                </div>
              </div>
            </Card>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button variant="tertiary" onPress={onCancel}>取消</Button>
            <Button variant="primary" onPress={onSubmit} isDisabled={!form.id.trim()}>
              <Icon icon="lucide:plus" className="size-4" />
              添加
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  )
}

function EmptyState({
  actions,
  description,
  icon,
  title,
}: {
  actions?: React.ReactNode
  description: string
  icon: string
  title: string
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl bg-surface px-6 py-10 text-center">
      <Icon icon={icon} className="size-8 text-muted" />
      <div className="mt-3 font-medium text-foreground">{title}</div>
      <div className="mt-1 max-w-sm text-sm leading-6 text-muted">{description}</div>
      {actions}
    </div>
  )
}

function ModelsSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-24 rounded-2xl" />
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
      </div>
      <Skeleton className="h-96 rounded-2xl" />
    </div>
  )
}

function configToProviderDrafts(content: Record<string, unknown>): ProviderDraft[] {
  const models = objectMap(content.models)
  const providers = objectMap(models.providers)
  return Object.entries(providers).map(([key, value]) => ({ key, ...normalizeProvider(value) }))
}

function normalizeProvider(value: unknown): OpenClawModelProvider {
  const provider = objectMap(value) as OpenClawModelProvider
  const models = Array.isArray(provider.models) ? provider.models.map((model) => normalizeModel(model)).filter((model) => model.id) : []
  return { ...provider, models }
}

function normalizeModel(value: unknown): OpenClawModelDefinition {
  const model = objectMap(value) as OpenClawModelDefinition
  return enrichModelContext({ ...model, id: String(model.id ?? '').trim(), name: model.name ? String(model.name) : undefined })
}

function readDefaultModelConfig(content: Record<string, unknown>): OpenClawDefaultModelConfig {
  const agents = objectMap(content.agents)
  const defaults = objectMap(agents.defaults)
  const model = defaults.model
  if (typeof model === 'string') return { primary: model, fallbacks: [] }
  const modelConfig = objectMap(model)
  return {
    primary: typeof modelConfig.primary === 'string' ? modelConfig.primary : '',
    fallbacks: Array.isArray(modelConfig.fallbacks) ? modelConfig.fallbacks.map(String).filter(Boolean) : [],
  }
}

function resolveModelReference(modelRef: string, providers: ProviderDraft[]) {
  const trimmed = modelRef.trim()
  if (!trimmed) return {}

  const provider = [...providers]
    .sort((a, b) => b.key.length - a.key.length)
    .find((item) => providerKeyStartsModelRef(trimmed, item.key))

  if (!provider) return {}

  const modelId = trimmed.slice(provider.key.length + 1)
  const model = (provider.models ?? []).find((item) => item.id === modelId)
  return { model, provider }
}

function modelRefsFromProviders(providers: ProviderDraft[]) {
  return providers.flatMap((provider) => (provider.models ?? [])
    .map((model) => model.id?.trim())
    .filter((modelId): modelId is string => Boolean(modelId))
    .map((modelId) => `${provider.key}/${modelId}`))
}

function withAutoDefaultModel(providers: ProviderDraft[], defaultModel: OpenClawDefaultModelConfig): OpenClawDefaultModelConfig {
  const modelRefs = modelRefsFromProviders(providers)
  const primary = defaultModel.primary?.trim()
  if (primary) {
    return {
      primary,
      fallbacks: (defaultModel.fallbacks ?? []).map((fallback) => fallback.trim()).filter((fallback) => fallback && fallback !== primary),
    }
  }

  const [firstModelRef, ...fallbacks] = modelRefs
  return {
    primary: firstModelRef ?? '',
    fallbacks,
  }
}

function buildConfigContent(content: Record<string, unknown>, providers: ProviderDraft[], defaultModel: OpenClawDefaultModelConfig): Record<string, unknown> {
  const nextContent = structuredCloneSafe(content)
  const models = objectMap(nextContent.models)
  const providerMap: Record<string, OpenClawModelProvider> = {}

  for (const provider of providers) {
    const key = toSafeProviderKey(provider.key)
    if (!key) continue
    const { key: _key, ...rest } = provider
    void _key
    const cleanModels = (rest.models ?? [])
      .map((model) => stripEmptyValues(model))
      .filter((model): model is OpenClawModelDefinition => objectMap(model).id !== undefined && String(objectMap(model).id).trim() !== '')
    const cleanProvider = stripEmptyValues({
      ...rest,
      models: cleanModels,
    }) as OpenClawModelProvider
    providerMap[key] = cleanProvider
  }

  models.mode = typeof models.mode === 'string' ? models.mode : 'merge'
  models.providers = providerMap
  nextContent.models = models

  const agents = objectMap(nextContent.agents)
  const defaults = objectMap(agents.defaults)
  defaults.model = stripEmptyValues({
    primary: defaultModel.primary?.trim() || undefined,
    fallbacks: (defaultModel.fallbacks ?? []).map((item) => item.trim()).filter(Boolean),
  })
  agents.defaults = defaults
  nextContent.agents = agents

  return nextContent
}

function configFingerprint(content: Record<string, unknown>, providers: ProviderDraft[], defaultModel: OpenClawDefaultModelConfig) {
  return JSON.stringify(buildConfigContent(content, providers, defaultModel))
}

function objectMap(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...(value as Record<string, unknown>) }
  return {}
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function stripEmptyValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripEmptyValues).filter((item) => item !== undefined)
  if (!value || typeof value !== 'object') return value === '' ? undefined : value
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === 'key') continue
    const next = stripEmptyValues(item)
    if (next === undefined) continue
    if (Array.isArray(next) && next.length === 0) continue
    if (next && typeof next === 'object' && !Array.isArray(next) && Object.keys(next).length === 0) continue
    result[key] = next
  }
  return result
}

function maskSecretValue(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}••••${trimmed.slice(-2)}`
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`
}

function parseModelLines(value: string) {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const numericValue = Number(trimmed)
  return Number.isFinite(numericValue) ? numericValue : undefined
}

function numberInput(value?: number) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

function formatContextWindow(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return ''
  if (value >= 1000) return `${Math.round(value / 1000)}K`
  return String(value)
}

function mergeModelsById(...groups: OpenClawModelDefinition[][]) {
  const seen = new Set<string>()
  const models: OpenClawModelDefinition[] = []
  for (const group of groups) {
    for (const model of group) {
      const id = model.id?.trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      models.push(model)
    }
  }
  return models
}

function modelComparableFingerprint(model: OpenClawModelDefinition) {
  return JSON.stringify(stripEmptyValues({
    contextWindow: model.contextWindow,
    contextTokens: model.contextTokens,
    id: model.id?.trim(),
    input: model.input,
    maxTokens: model.maxTokens,
    name: model.name?.trim(),
    reasoning: model.reasoning,
  }))
}

function modelsEquivalent(left: OpenClawModelDefinition[], right: OpenClawModelDefinition[]) {
  const leftFingerprints = left.map(modelComparableFingerprint).sort()
  const rightFingerprints = right.map(modelComparableFingerprint).sort()
  return JSON.stringify(leftFingerprints) === JSON.stringify(rightFingerprints)
}

function withGeneratedModelName(model: OpenClawModelDefinition): OpenClawModelDefinition {
  return enrichModelContext({
    ...model,
    name: titleizeModelId(model.id),
  })
}

function enrichModelContext(model: OpenClawModelDefinition): OpenClawModelDefinition {
  if (model.contextWindow || model.contextTokens) return model
  const inferredContextWindow = inferContextWindowFromModelId(model.id || model.name || '')
  return inferredContextWindow ? { ...model, contextWindow: inferredContextWindow } : model
}

function inferContextWindowFromModelId(modelId: string) {
  const match = modelId.toLowerCase().match(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)([km])(?:[^a-z0-9]|$)/)
  if (!match) return undefined

  const value = Number(match[1])
  if (!Number.isFinite(value) || value <= 0) return undefined

  const multiplier = match[2] === 'm' ? 1_000_000 : 1_000
  return Math.round(value * multiplier)
}

function titleizeModelId(modelId: string) {
  const leaf = modelId.split('/').filter(Boolean).at(-1) ?? modelId
  return leaf
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

async function openExternalUrl(url?: string) {
  await openUrl(url)
}

function sameProviderKey(left?: string, right?: string) {
  return String(left ?? '').trim().toLowerCase() === String(right ?? '').trim().toLowerCase()
}

function providerKeyStartsModelRef(modelRef: string, providerKey: string) {
  return modelRef.toLowerCase().startsWith(`${providerKey.toLowerCase()}/`)
}

function toSafeProviderKey(value: string) {
  return value.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_.-]/g, '')
}

function providerLogoSrc(providerKey: string, providerCatalog: ProviderCatalog, icon?: string) {
  const catalogProvider = findCatalogProvider(providerKey, providerCatalog)
  if (catalogProvider?.logoUrl) return catalogProvider.logoUrl
  return modelIconUrl(icon ?? catalogProvider?.icon)
}

function modelLogoSrc(model: OpenClawModelDefinition, providerKey: string, modelCatalog: ModelCatalog, providerCatalog: ProviderCatalog) {
  const catalogModel = findCatalogModel(model, providerKey, modelCatalog)
  const catalogProvider = findCatalogProvider(providerKey, providerCatalog)
  if (catalogProvider?.logoUrl) return catalogProvider.logoUrl
  return modelIconUrl(catalogModel?.icon ?? catalogProvider?.icon)
}

function findCatalogModel(model: OpenClawModelDefinition, providerKey: string, modelCatalog: ModelCatalog) {
  const models = modelCatalog[providerKey] ?? modelCatalog[providerKey.toLowerCase()] ?? []
  return models.find((item) => item.id === model.id || item.name === model.name || item.id === model.name || item.name === model.id)
}

function findCatalogProvider(providerKey: string, providerCatalog: ProviderCatalog) {
  return providerCatalog.find((provider) => sameProviderKey(provider.key, providerKey))
}

function mergeProviderCatalogEntries(...groups: ProviderCatalog[]) {
  const seen = new Set<string>()
  const entries: ProviderCatalog = []
  for (const group of groups) {
    for (const provider of group) {
      const key = provider.key?.trim()
      const normalized = key?.toLowerCase()
      if (!key || !normalized || seen.has(normalized)) continue
      seen.add(normalized)
      entries.push(provider)
    }
  }
  return entries
}

function mergeProviderPresets(...groups: ProviderPreset[][]) {
  const seen = new Set<string>()
  const presets: ProviderPreset[] = []
  for (const group of groups) {
    for (const preset of group) {
      const key = preset.key?.trim()
      const normalized = key?.toLowerCase()
      if (!key || !normalized || seen.has(normalized)) continue
      seen.add(normalized)
      presets.push(preset)
    }
  }
  return presets
}

function modelInitializationToPreset(value: unknown): ProviderPreset | null {
  const payload = objectMap(value)
  const providerKey = String(payload.providerKey ?? '').trim()
  const baseUrl = String(payload.baseUrl ?? '').trim()
  if (!providerKey || !baseUrl) return null

  const i18n = objectMap(payload.i18n)
  const title = i18n.Title
  const description = i18n.Desc
  const defaultModel = catalogLikeModelToOpenClawModel(payload.defaultModel)
  const fallbackModels = Array.isArray(payload.fallbackModels)
    ? payload.fallbackModels.map(catalogLikeModelToOpenClawModel).filter(isOpenClawModelDefinition)
    : []
  const buttons = Array.isArray(payload.buttons)
    ? payload.buttons
      .map((button) => {
        const item = objectMap(button)
        return {
          label: String(item.label ?? '').trim(),
          link: String(item.link ?? '').trim(),
        }
      })
      .filter((button) => button.label && button.link)
    : []
  const websiteButton = buttons.find((button) => button.link)
  void websiteButton

  return {
    api: String(payload.api ?? 'openai-completions') as OpenClawModelApiType,
    apiKey: typeof payload.defaultKey === 'string' ? payload.defaultKey : undefined,
    apiKeyUrl: undefined,
    baseUrl,
    buttons,
    description: typeof description === 'string' && description.trim() ? description.trim() : undefined,
    icon: typeof payload.icon === 'string' ? payload.icon : undefined,
    key: providerKey,
    logoUrl: typeof payload.logoUrl === 'string' ? payload.logoUrl : undefined,
    models: mergeModelsById(defaultModel ? [defaultModel] : [], fallbackModels).filter((model) => model.id),
    name: typeof title === 'string' && title.trim() ? title.trim() : providerKey,
  }
}

function presetToProviderCatalogEntry(preset: ProviderPreset): ProviderCatalogEntry {
  return {
    apiKeyUrl: preset.apiKeyUrl,
    baseUrl: preset.baseUrl,
    docsUrl: preset.docsUrl,
    icon: preset.icon,
    key: preset.key,
    label: preset.name,
    logoUrl: preset.logoUrl,
    modelApi: preset.api,
    models: preset.models.map((model) => ({
      contextWindow: model.contextWindow,
      id: model.id,
      name: model.name,
      reasoning: model.reasoning,
      vision: model.input?.includes('image'),
    })),
  }
}

function catalogLikeModelToOpenClawModel(value: unknown): OpenClawModelDefinition | null {
  const model = objectMap(value)
  const id = String(model.id ?? '').trim()
  if (!id) return null

  return enrichModelContext({
    id,
    name: typeof model.name === 'string' && model.name.trim() ? model.name.trim() : id,
    contextWindow: typeof model.contextWindow === 'number' ? model.contextWindow : undefined,
    input: model.vision ? ['text', 'image'] : ['text'],
    reasoning: typeof model.reasoning === 'boolean' ? model.reasoning : undefined,
  })
}

function isOpenClawModelDefinition(model: OpenClawModelDefinition | null): model is OpenClawModelDefinition {
  return Boolean(model?.id)
}

function modelInitializationPresetKeyMatchesProvider(preset: ProviderPreset, provider: ProviderDraft) {
  return Boolean(preset.logoUrl && sameProviderKey(preset.key, provider.key))
}

function providerCatalogToPresets(providerCatalog: ProviderCatalog): ProviderPreset[] {
  return providerCatalog
    .filter((provider) => provider.key && provider.baseUrl)
    .map((provider) => ({
      api: providerTypeToApi(provider.modelApi),
      apiKeyUrl: provider.apiKeyUrl,
      baseUrl: provider.baseUrl ?? '',
      docsUrl: provider.docsUrl,
      icon: provider.icon,
      key: provider.key,
      logoUrl: provider.logoUrl,
      models: (provider.models ?? []).map(catalogModelToOpenClawModel).filter((model) => model.id),
      name: provider.label?.trim() || provider.key,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

function catalogModelToOpenClawModel(model: CatalogModelEntry): OpenClawModelDefinition {
  return enrichModelContext({
    id: String(model.id ?? '').trim(),
    name: model.name?.trim() || model.id,
    contextWindow: model.contextWindow,
    input: model.vision ? ['text', 'image'] : ['text'],
    reasoning: model.reasoning,
  })
}

function providerTypeToApi(modelApi?: string): OpenClawModelApiType {
  const normalized = String(modelApi ?? '').toLowerCase()
  if (normalized === 'google-gemini') return 'google-generative-ai'
  if (normalized === 'anthropic-messages') return 'anthropic-messages'
  if (normalized === 'openai-completions') return 'openai-completions'
  return 'openai-completions'
}

function modelIconUrl(icon?: string) {
  const modelIconBaseUrl = useConfigStore.getState().modelIconBaseUrl
  if (!icon) return `${modelIconBaseUrl}Other.svg`
  if (/^https?:\/\//i.test(icon)) return icon
  return `${modelIconBaseUrl}${encodeURIComponent(icon)}`
}

function providerDisplayName(providerKey: string, providerCatalog: ProviderCatalog) {
  const catalogProvider = findCatalogProvider(providerKey, providerCatalog)
  return catalogProvider?.label?.trim() || providerKey
}

function renameModelRefs(value: OpenClawDefaultModelConfig, oldProvider: string, nextProvider: string): OpenClawDefaultModelConfig {
  return {
    primary: value.primary?.startsWith(`${oldProvider}/`) ? value.primary.replace(`${oldProvider}/`, `${nextProvider}/`) : value.primary,
    fallbacks: (value.fallbacks ?? []).map((fallback) => fallback.startsWith(`${oldProvider}/`) ? fallback.replace(`${oldProvider}/`, `${nextProvider}/`) : fallback),
  }
}

function renameModelRefLines(value: string, oldProvider: string, nextProvider: string) {
  return parseModelLines(value).map((fallback) => fallback.startsWith(`${oldProvider}/`) ? fallback.replace(`${oldProvider}/`, `${nextProvider}/`) : fallback).join('\n')
}

function removeProviderRefs(value: OpenClawDefaultModelConfig, providerKey: string): OpenClawDefaultModelConfig {
  return {
    primary: value.primary?.startsWith(`${providerKey}/`) ? '' : value.primary,
    fallbacks: (value.fallbacks ?? []).filter((fallback) => !fallback.startsWith(`${providerKey}/`)),
  }
}

export default OpenClawModelsPage

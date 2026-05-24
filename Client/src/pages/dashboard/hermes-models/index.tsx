import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Key } from '@heroui/react'
import { AlertDialog, Button, Card, Chip, Description, Dropdown, InputGroup, Label, ListBox, SearchField, Skeleton, Switch, TextField, Tooltip, toast } from '@heroui/react'
import { CellSelect, ItemCard, ItemCardGroup } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import type { HermesAgentModelSettings, HermesAuxiliaryVisionConfig, HermesFallbackProvider, HermesImageInputMode, HermesModelApiMode, HermesModelDefinition, HermesModelProvider, HermesModelsResponse } from '@/api'
import { fetchHermesProviderModels, getHermesModels, testHermesProviderModel, updateHermesModels } from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import DashboardLayout from '@/layouts/Dashboard'
import { useConfigStore } from '@/stores/config'
import { useHermesAgentStore } from '@/stores/hermes-agent'
import { openExternalUrl as openUrl } from '@/utils/openExternalUrl'
import { HermesLoadErrorCard } from '../hermes-shared/HermesLoadErrorCard'
import { HermesModelsHeroIllustration } from './HermesModelsHeroIllustration'

type LoadState = 'idle' | 'loading' | 'saving' | 'ready' | 'error'
type ProviderDraft = HermesModelProvider & { key: string }
type ProviderEditorMode = 'create' | 'edit'

type ProviderFormState = {
  apiKey: string
  apiMode: HermesModelApiMode
  baseUrl: string
  defaultModel: string
  key: string
  keyEnv: string
  name: string
  presetKey: string
  requestTimeoutSeconds: string
  staleTimeoutSeconds: string
}

type HermesProviderPreset = {
  apiMode: HermesModelApiMode
  apiKey?: string
  apiKeyUrl?: string
  baseUrl: string
  buttons?: ProviderPresetButton[]
  defaultModel?: string
  description?: string
  docsUrl?: string
  icon?: string
  key: string
  keyEnv?: string
  logoUrl?: string
  models: HermesModelDefinition[]
  name: string
}

type ProviderPresetButton = {
  label: string
  link: string
}

type CatalogModelEntry = {
  contextWindow?: number
  icon?: string
  id: string
  name?: string
  reasoning?: boolean
  vision?: boolean
}

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
type ModelCatalog = Record<string, CatalogModelEntry[]>

type ModelFormState = {
  contextLength: string
  id: string
  maxTokens: string
  name: string
  reasoning: boolean
}

const apiModeOptions: HermesModelApiMode[] = ['chat_completions', 'anthropic_messages', 'codex_responses', 'bedrock_converse']
const imageInputModeOptions: HermesImageInputMode[] = ['auto', 'native', 'text']
const defaultAgentModelSettings: HermesAgentModelSettings = { imageInputMode: 'auto' }
const defaultAuxiliaryVisionConfig: HermesAuxiliaryVisionConfig = {
  downloadTimeout: 30,
  extraBody: {},
  provider: 'auto',
  timeout: 120,
}
const emptyProviderForm: ProviderFormState = {
  apiKey: '',
  apiMode: 'chat_completions',
  baseUrl: '',
  defaultModel: '',
  key: '',
  keyEnv: '',
  name: '',
  presetKey: '',
  requestTimeoutSeconds: '',
  staleTimeoutSeconds: '',
}
const emptyModelForm: ModelFormState = {
  contextLength: '',
  id: '',
  maxTokens: '',
  name: '',
  reasoning: false,
}
const numberFormatter = new Intl.NumberFormat('zh-CN')
const manualPresetKey = '__manual__'
const visionDefaultModelKey = '__provider_default__'

const fallbackHermesProviderPresets: HermesProviderPreset[] = [
  {
    apiMode: 'chat_completions',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-5.5',
    key: 'openrouter',
    keyEnv: 'OPENROUTER_API_KEY',
    name: 'OpenRouter',
    models: [
      { contextLength: 400000, contextWindow: 400000, id: 'openai/gpt-5.5', input: ['text', 'image'], name: 'GPT 5.5', reasoning: true },
      { contextLength: 200000, contextWindow: 200000, id: 'anthropic/claude-sonnet-4.5', input: ['text', 'image'], name: 'Claude Sonnet 4.5', reasoning: true },
      { contextLength: 200000, contextWindow: 200000, id: 'google/gemini-2.5-pro', input: ['text', 'image'], name: 'Gemini 2.5 Pro', reasoning: true },
    ],
  },
  {
    apiMode: 'anthropic_messages',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-5',
    key: 'anthropic',
    keyEnv: 'ANTHROPIC_API_KEY',
    name: 'Anthropic',
    models: [
      { contextLength: 200000, contextWindow: 200000, id: 'claude-sonnet-4-5', input: ['text', 'image'], name: 'Claude Sonnet 4.5', reasoning: true },
      { contextLength: 200000, contextWindow: 200000, id: 'claude-opus-4-1', input: ['text', 'image'], name: 'Claude Opus 4.1', reasoning: true },
    ],
  },
  {
    apiMode: 'codex_responses',
    baseUrl: 'https://chatgpt.com/backend-api/codex',
    defaultModel: 'gpt-5.5',
    key: 'openai-codex',
    name: 'OpenAI Codex',
    models: [
      { contextLength: 400000, contextWindow: 400000, id: 'gpt-5.5', input: ['text', 'image'], name: 'GPT 5.5', reasoning: true },
      { contextLength: 400000, contextWindow: 400000, id: 'gpt-5.4', input: ['text', 'image'], name: 'GPT 5.4', reasoning: true },
    ],
  },
  {
    apiMode: 'chat_completions',
    baseUrl: 'http://127.0.0.1:1234/v1',
    key: 'lmstudio',
    keyEnv: 'LM_API_KEY',
    name: 'LM Studio',
    models: [],
  },
  {
    apiMode: 'chat_completions',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    key: 'deepseek',
    keyEnv: 'DEEPSEEK_API_KEY',
    name: 'DeepSeek',
    models: [
      { contextLength: 128000, contextWindow: 128000, id: 'deepseek-chat', input: ['text'], name: 'DeepSeek Chat' },
      { contextLength: 128000, contextWindow: 128000, id: 'deepseek-reasoner', input: ['text'], name: 'DeepSeek Reasoner', reasoning: true },
    ],
  },
  {
    apiMode: 'chat_completions',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3-coder-plus',
    key: 'alibaba',
    keyEnv: 'DASHSCOPE_API_KEY',
    name: 'Alibaba Cloud',
    models: [
      { contextLength: 1000000, contextWindow: 1000000, id: 'qwen3-coder-plus', input: ['text'], name: 'Qwen3 Coder Plus', reasoning: true },
      { contextLength: 128000, contextWindow: 128000, id: 'qwen-plus', input: ['text'], name: 'Qwen Plus' },
    ],
  },
  {
    apiMode: 'anthropic_messages',
    baseUrl: 'https://api.minimax.io/anthropic',
    defaultModel: 'minimax-m2.7:cloud',
    key: 'minimax',
    keyEnv: 'MINIMAX_API_KEY',
    name: 'MiniMax',
    models: [
      { contextLength: 196608, contextWindow: 196608, id: 'minimax-m2.7:cloud', input: ['text'], name: 'MiniMax M2.7 Cloud' },
    ],
  },
]

function HermesModelsPage() {
  usePageTitle('Hermes 模型配置')
  const modelCatalogUrl = useConfigStore((store) => store.modelCatalogUrl)
  const modelInitializationUrl = useConfigStore((store) => store.modelInitializationUrl)
  const selectedAgentName = useHermesAgentStore((store) => store.selectedName)
  const loadAgents = useHermesAgentStore((store) => store.loadAgents)
  const [state, setState] = useState<LoadState>('idle')
  const [data, setData] = useState<HermesModelsResponse | null>(null)
  const [error, setError] = useState('')
  const [agentSettings, setAgentSettings] = useState<HermesAgentModelSettings>(defaultAgentModelSettings)
  const [auxiliaryVision, setAuxiliaryVision] = useState<HermesAuxiliaryVisionConfig>(defaultAuxiliaryVisionConfig)
  const [providers, setProviders] = useState<ProviderDraft[]>([])
  const [selectedProviderKey, setSelectedProviderKey] = useState('')
  const [modelConfig, setModelConfig] = useState<HermesModelsResponse['model']>({})
  const [fallbackProviders, setFallbackProviders] = useState<HermesFallbackProvider[]>([])
  const [savedFingerprint, setSavedFingerprint] = useState('')
  const [query, setQuery] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorMode, setEditorMode] = useState<ProviderEditorMode>('create')
  const [editorOriginalKey, setEditorOriginalKey] = useState('')
  const [visionSettingsOpen, setVisionSettingsOpen] = useState(false)
  const [providerForm, setProviderForm] = useState<ProviderFormState>(emptyProviderForm)
  const [editorModels, setEditorModels] = useState<HermesModelDefinition[]>([])
  const [fetchedEditorModels, setFetchedEditorModels] = useState<HermesModelDefinition[]>([])
  const [hasFetchedEditorModels, setHasFetchedEditorModels] = useState(false)
  const [addModelOpen, setAddModelOpen] = useState(false)
  const [addModelTarget, setAddModelTarget] = useState<'detail' | 'editor'>('detail')
  const [modelForm, setModelForm] = useState<ModelFormState>(emptyModelForm)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [testingModelId, setTestingModelId] = useState('')
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalog>([])
  const [modelCatalog, setModelCatalog] = useState<ModelCatalog>({})
  const [modelInitializationPreset, setModelInitializationPreset] = useState<HermesProviderPreset | null>(null)

  const loadModels = useCallback(async () => {
    setState('loading')
    setError('')
    try {
      const payload = await getHermesModels(selectedAgentName)
      const nextProviders = responseProvidersToDrafts(payload)
      const nextModel = normalizeModelConfigProvider(payload.model ?? {})
      const nextFallbackProviders = normalizeFallbackProviderKeys(payload.fallbackProviders ?? [])
      const nextAuxiliaryVision = normalizeAuxiliaryVision(payload.auxiliaryVision)
      setData(payload)
      setAgentSettings(normalizeAgentSettings(payload.agent))
      setAuxiliaryVision(nextAuxiliaryVision)
      setProviders(nextProviders)
      setModelConfig(nextModel)
      setFallbackProviders(nextFallbackProviders)
      setSelectedProviderKey((current) => current && nextProviders.some((provider) => provider.key === current) ? current : nextProviders[0]?.key ?? '')
      setSavedFingerprint(fingerprint(nextModel, nextProviders, nextFallbackProviders, payload.credentialPoolStrategies, normalizeAgentSettings(payload.agent), nextAuxiliaryVision))
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hermes 模型配置加载失败')
      setState('error')
    }
  }, [selectedAgentName])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAgents(false)
      void loadModels()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadAgents, loadModels])

  const loadProviderCatalog = useCallback(async () => {
    try {
      const response = await fetch(modelCatalogUrl)
      const payload = response.ok ? await response.json() as ProviderCatalog : []
      const catalog = Array.isArray(payload) ? payload : []
      setProviderCatalog((current) => mergeProviderCatalogEntries(current, catalog))
      setModelCatalog((current) => ({ ...current, ...Object.fromEntries(catalog.map((provider) => [provider.key, provider.models ?? []])) }))
    } catch {
      setProviderCatalog((current) => current)
      setModelCatalog((current) => current)
    }
  }, [modelCatalogUrl])

  const loadModelInitializationPreset = useCallback(async () => {
    try {
      const response = await fetch(modelInitializationUrl)
      const payload = response.ok ? await response.json() : null
      const preset = modelInitializationToHermesPreset(payload)
      setModelInitializationPreset(preset)
      setProviderCatalog((current) => preset ? mergeProviderCatalogEntries([presetToProviderCatalogEntry(preset)], current) : current)
    } catch {
      setModelInitializationPreset(null)
    }
  }, [modelInitializationUrl])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadProviderCatalog()
      void loadModelInitializationPreset()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadModelInitializationPreset, loadProviderCatalog])

  const filteredProviders = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return providers
    return providers.filter((provider) => providerSearchText(provider).includes(needle))
  }, [providers, query])
  const selectedProvider = useMemo(() => {
    if (filteredProviders.some((provider) => provider.key === selectedProviderKey)) {
      return filteredProviders.find((provider) => provider.key === selectedProviderKey) ?? null
    }
    return filteredProviders[0] ?? null
  }, [filteredProviders, selectedProviderKey])
  const stats = useMemo(() => {
    const modelCount = providers.reduce((sum, provider) => sum + (provider.models?.length ?? 0), 0)
    return {
      fallbackCount: fallbackProviders.length,
      modelCount,
      providerCount: providers.length,
    }
  }, [fallbackProviders.length, providers])
  const providerPresets = useMemo(() => {
    const presets = mergeProviderPresets(
      modelInitializationPreset ? [modelInitializationPreset] : [],
      providerCatalogToHermesPresets(providerCatalog),
    )
    return presets.length ? presets : fallbackHermesProviderPresets
  }, [modelInitializationPreset, providerCatalog])
  const hasInitializationProvider = useMemo(() => Boolean(
    modelInitializationPreset && providers.some((provider) => sameProviderKey(provider.key, modelInitializationPreset.key)),
  ), [modelInitializationPreset, providers])
  const primaryProvider = useMemo(() => providers.find((provider) => provider.key === modelConfig.provider) ?? null, [modelConfig.provider, providers])
  const primaryModel = useMemo(() => primaryProvider?.models?.find((model) => model.id === modelConfig.default) ?? null, [modelConfig.default, primaryProvider])
  const nextFingerprint = useMemo(() => fingerprint(modelConfig, providers, fallbackProviders, data?.credentialPoolStrategies, agentSettings, auxiliaryVision), [agentSettings, auxiliaryVision, data?.credentialPoolStrategies, fallbackProviders, modelConfig, providers])
  const hasUnsavedChanges = Boolean(savedFingerprint) && nextFingerprint !== savedFingerprint
  const isLoading = state === 'loading' && !data
  const isSaving = state === 'saving'

  useEffect(() => {
    if (!hasUnsavedChanges) return

    toast.warning('Hermes 模型配置有未保存修改', {
      description: '修改只在当前页面草稿中，点击保存后才会写入 config.yaml。',
    })
  }, [hasUnsavedChanges])

  const openCreateProvider = useCallback(() => {
    setEditorMode('create')
    setEditorOriginalKey('')
    setProviderForm(emptyProviderForm)
    setEditorModels([])
    setFetchedEditorModels([])
    setHasFetchedEditorModels(false)
    setEditorOpen(true)
  }, [])

  const openInitializationProvider = useCallback(() => {
    if (!modelInitializationPreset || hasInitializationProvider) return

    setEditorMode('create')
    setEditorOriginalKey('')
    setProviderForm({
      ...emptyProviderForm,
      apiKey: modelInitializationPreset.apiKey ?? '',
      apiMode: modelInitializationPreset.apiMode,
      baseUrl: modelInitializationPreset.baseUrl,
      defaultModel: modelInitializationPreset.defaultModel ?? modelInitializationPreset.models[0]?.id ?? '',
      key: modelInitializationPreset.key,
      keyEnv: modelInitializationPreset.keyEnv ?? '',
      name: modelInitializationPreset.name,
      presetKey: modelInitializationPreset.key,
    })
    setEditorModels(modelInitializationPreset.models)
    setFetchedEditorModels([])
    setHasFetchedEditorModels(false)
    setEditorOpen(true)
  }, [hasInitializationProvider, modelInitializationPreset])

  const openEditProvider = useCallback((provider: ProviderDraft) => {
    setEditorMode('edit')
    setEditorOriginalKey(provider.key)
    setProviderForm({
      apiKey: provider.apiKey ?? '',
      apiMode: normalizeApiMode(provider.apiMode),
      baseUrl: provider.baseUrl ?? '',
      defaultModel: provider.defaultModel ?? provider.model ?? '',
      key: provider.key,
      keyEnv: provider.keyEnv ?? '',
      name: provider.name ?? '',
      presetKey: findProviderPreset(provider, providerPresets)?.key ?? '',
      requestTimeoutSeconds: provider.requestTimeoutSeconds ? String(provider.requestTimeoutSeconds) : '',
      staleTimeoutSeconds: provider.staleTimeoutSeconds ? String(provider.staleTimeoutSeconds) : '',
    })
    setEditorModels(provider.models ?? [])
    setFetchedEditorModels([])
    setHasFetchedEditorModels(false)
    setEditorOpen(true)
  }, [providerPresets])

  const submitProvider = useCallback(() => {
    const key = toProviderKey(providerForm.key)
    if (!key) {
      toast.warning('请输入 Provider ID')
      return
    }
    if (providers.some((provider) => provider.key === key && provider.key !== editorOriginalKey)) {
      toast.warning('Provider ID 已存在')
      return
    }
    const previousProvider = providers.find((provider) => provider.key === editorOriginalKey)
    const nextProvider: ProviderDraft = {
      ...(previousProvider ?? {}),
      apiKey: providerForm.apiKey.trim(),
      apiMode: providerForm.apiMode,
      baseUrl: providerForm.baseUrl.trim(),
      defaultModel: providerForm.defaultModel.trim(),
      key,
      keyEnv: providerForm.keyEnv.trim(),
      models: editorModels,
      name: providerForm.name.trim(),
      requestTimeoutSeconds: parseOptionalNumber(providerForm.requestTimeoutSeconds),
      staleTimeoutSeconds: parseOptionalNumber(providerForm.staleTimeoutSeconds),
    }

    setProviders((current) => editorMode === 'create'
      ? [...current, nextProvider]
      : current.map((provider) => provider.key === editorOriginalKey ? nextProvider : provider))
    if (editorOriginalKey && editorOriginalKey !== key) {
      setModelConfig((current) => current.provider === editorOriginalKey ? { ...current, provider: key } : current)
      setFallbackProviders((current) => current.map((fallback) => fallback.provider === editorOriginalKey ? { ...fallback, provider: key } : fallback))
      setAuxiliaryVision((current) => current.provider === editorOriginalKey ? { ...current, provider: key } : current)
    }
    setSelectedProviderKey(key)
    setEditorOpen(false)
  }, [editorMode, editorModels, editorOriginalKey, providerForm, providers])

  const deleteProvider = useCallback((providerKey: string) => {
    const nextProviders = providers.filter((provider) => provider.key !== providerKey)
    setProviders(nextProviders)
    setSelectedProviderKey((current) => current === providerKey ? nextProviders[0]?.key ?? '' : current)
    setFallbackProviders((current) => current.filter((fallback) => fallback.provider !== providerKey))
    setModelConfig((current) => current.provider === providerKey ? { ...current, default: '', provider: '' } : current)
    setAuxiliaryVision((current) => current.provider === providerKey ? { ...current, model: '', provider: 'auto' } : current)
  }, [providers])

  const saveModels = useCallback(async () => {
    setState('saving')
    setError('')
    try {
      const payload = await updateHermesModels({
        agent: normalizeAgentSettings(agentSettings),
        auxiliaryVision: normalizeAuxiliaryVision(auxiliaryVision),
        credentialPoolStrategies: data?.credentialPoolStrategies,
        fallbackProviders: normalizeFallbackProviderKeys(fallbackProviders),
        model: normalizeModelConfigProvider(modelConfig),
        providers: Object.fromEntries(providers.map((provider) => [provider.key, stripProvider(provider)])),
      }, selectedAgentName)
      const nextProviders = responseProvidersToDrafts(payload)
      const nextModel = normalizeModelConfigProvider(payload.model ?? {})
      const nextFallbackProviders = normalizeFallbackProviderKeys(payload.fallbackProviders ?? [])
      const nextAuxiliaryVision = normalizeAuxiliaryVision(payload.auxiliaryVision)
      setData(payload)
      setAgentSettings(normalizeAgentSettings(payload.agent))
      setAuxiliaryVision(nextAuxiliaryVision)
      setProviders(nextProviders)
      setModelConfig(nextModel)
      setFallbackProviders(nextFallbackProviders)
      setSelectedProviderKey((current) => current && nextProviders.some((provider) => provider.key === current) ? current : nextProviders[0]?.key ?? '')
      setSavedFingerprint(fingerprint(nextModel, nextProviders, nextFallbackProviders, payload.credentialPoolStrategies, normalizeAgentSettings(payload.agent), nextAuxiliaryVision))
      setState('ready')
      toast.success('Hermes 模型配置已保存')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hermes 模型配置保存失败')
      setState('error')
      toast.warning('Hermes 模型配置保存失败')
    }
  }, [agentSettings, auxiliaryVision, data, fallbackProviders, modelConfig, providers, selectedAgentName])

  const fetchEditorModels = useCallback(async () => {
    if (!providerForm.baseUrl.trim()) {
      toast.warning('请先填写 Provider Base URL')
      return
    }
    setFetchingModels(true)
    try {
      const payload = await fetchHermesProviderModels({
        apiKey: providerForm.apiKey.trim(),
        apiMode: providerForm.apiMode,
        baseUrl: providerForm.baseUrl.trim(),
      })
      setFetchedEditorModels(payload.models)
      setHasFetchedEditorModels(true)
      toast.success(`已获取 ${payload.models.length} 个模型`)
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '获取模型列表失败')
    } finally {
      setFetchingModels(false)
    }
  }, [providerForm.apiKey, providerForm.apiMode, providerForm.baseUrl])

  const testModel = useCallback(async (provider: ProviderDraft, model: HermesModelDefinition) => {
    if (!provider.baseUrl?.trim()) {
      toast.warning('请先填写 Provider Base URL')
      return
    }
    setTestingModelId(`${provider.key}/${model.id}`)
    try {
      const result = await testHermesProviderModel({
        apiKey: provider.apiKey?.trim(),
        apiMode: provider.apiMode,
        baseUrl: provider.baseUrl.trim(),
        model: model.id,
      })
      if (result.ok) {
        toast.success(`${model.name || model.id} 连通正常（${result.durationMs}ms）`)
      } else {
        toast.warning(result.message || '模型连通性测试失败')
      }
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '模型连通性测试失败')
    } finally {
      setTestingModelId('')
    }
  }, [])

  const testEditorModel = useCallback(async (model: HermesModelDefinition) => {
    if (!providerForm.baseUrl.trim()) {
      toast.warning('请先填写 Provider Base URL')
      return
    }
    setTestingModelId(`editor/${model.id}`)
    try {
      const result = await testHermesProviderModel({
        apiKey: providerForm.apiKey.trim(),
        apiMode: providerForm.apiMode,
        baseUrl: providerForm.baseUrl.trim(),
        model: model.id,
      })
      if (result.ok) {
        toast.success(`${model.name || model.id} 连通正常（${result.durationMs}ms）`)
      } else {
        toast.warning(result.message || '模型连通性测试失败')
      }
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '模型连通性测试失败')
    } finally {
      setTestingModelId('')
    }
  }, [providerForm.apiKey, providerForm.apiMode, providerForm.baseUrl])

  const addModel = useCallback((providerKey?: string) => {
    const id = modelForm.id.trim()
    if (!id) {
      toast.warning('请输入模型 ID')
      return
    }
    const nextModel: HermesModelDefinition = {
      contextLength: parseOptionalNumber(modelForm.contextLength),
      contextWindow: parseOptionalNumber(modelForm.contextLength),
      id,
      input: ['text'],
      maxTokens: parseOptionalNumber(modelForm.maxTokens),
      name: modelForm.name.trim() || titleizeModel(id),
      reasoning: modelForm.reasoning || undefined,
    }
    if (addModelTarget === 'editor') {
      setEditorModels((current) => mergeModels(current, [nextModel]))
    } else {
      if (!providerKey) return
      setProviders((current) => current.map((provider) => provider.key === providerKey ? { ...provider, models: mergeModels(provider.models ?? [], [nextModel]) } : provider))
    }
    setAddModelOpen(false)
    setModelForm(emptyModelForm)
  }, [addModelTarget, modelForm])

  const deleteModel = useCallback((providerKey: string, modelId: string) => {
    setProviders((current) => current.map((provider) => provider.key === providerKey ? { ...provider, models: (provider.models ?? []).filter((model) => model.id !== modelId) } : provider))
    setFallbackProviders((current) => current.filter((fallback) => !(fallback.provider === providerKey && fallback.model === modelId)))
    setModelConfig((current) => current.provider === providerKey && current.default === modelId ? { ...current, default: '', provider: '' } : current)
    setAuxiliaryVision((current) => current.provider === providerKey && current.model === modelId ? { ...current, model: '' } : current)
  }, [])

  const setPrimaryModel = useCallback((providerKey: string, modelId: string) => {
    const provider = providers.find((item) => item.key === providerKey)
    setModelConfig((current) => ({
      ...current,
      apiMode: provider?.apiMode || current.apiMode,
      baseUrl: provider?.baseUrl || current.baseUrl,
      default: modelId,
      provider: providerKey,
    }))
    setFallbackProviders((current) => current.filter((fallback) => !(fallback.provider === providerKey && fallback.model === modelId)))
  }, [providers])

  const setVisionModel = useCallback((providerKey: string, modelId: string) => {
    const provider = providers.find((item) => item.key === providerKey)
    const model = provider?.models?.find((item) => item.id === modelId)
    setAgentSettings((current) => ({ ...current, imageInputMode: 'text' }))
    setAuxiliaryVision((current) => ({
      ...current,
      apiKey: '',
      apiMode: provider?.apiMode || normalizeAuxiliaryVision(current).apiMode,
      baseUrl: '',
      model: modelId,
      provider: providerKey,
    }))
    toast.success(`${model?.name || modelId} 已设为视觉模型`)
  }, [providers])

  const toggleFallback = useCallback((providerKey: string, modelId: string) => {
    if (modelConfig.provider === providerKey && modelConfig.default === modelId) return
    setFallbackProviders((current) => {
      const exists = current.some((fallback) => fallback.provider === providerKey && fallback.model === modelId)
      return exists
        ? current.filter((fallback) => !(fallback.provider === providerKey && fallback.model === modelId))
        : [...current, { provider: providerKey, model: modelId }]
    })
  }, [modelConfig.default, modelConfig.provider])

  return (
    <DashboardLayout>
      <div className={error && !data ? 'flex min-h-[calc(100dvh-8rem)] items-center justify-center' : 'mx-auto flex max-w-7xl flex-col gap-6'}>
        {error && !data ? (
          <HermesLoadErrorCard
            error={error}
            isRetrying={state === 'loading'}
            title="无法加载 Hermes 模型配置"
            onRetry={() => void loadModels()}
          />
        ) : null}

        {error && data ? (
          <Card className="bg-danger/10 text-danger">
            <Card.Content>
              <div className="flex items-start gap-3">
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

        {data ? (
          <>
            <section className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
              <Card variant="transparent" className="h-full overflow-visible">
                <Card.Content className="flex h-full items-center justify-start overflow-visible">
                  <div className="flex w-full flex-row items-center gap-4 overflow-visible md:gap-6">
                    <div className="flex h-36 shrink-0 items-center justify-center overflow-visible rounded-2xl p-1 drop-shadow-[0_8px_14px_color-mix(in_oklch,var(--accent)_28%,transparent)]">
                      <HermesModelsHeroIllustration className="h-full w-auto md:scale-105" />
                    </div>
                    <div className="min-w-0 flex flex-col gap-1">
                      <Card.Title className="text-2xl font-bold md:text-3xl">模型配置</Card.Title>
                      <Card.Description className="mt-4 text-base md:text-lg">管理 config.yaml 中的主模型、Provider、模型清单和 fallback 链。</Card.Description>
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <Button variant="primary" onPress={openCreateProvider} isDisabled={isSaving}>
                          <Icon icon="lucide:plus" className="size-4" />
                          添加服务商
                        </Button>
                        {modelInitializationPreset && !hasInitializationProvider ? (
                          <Button variant="tertiary" onPress={openInitializationProvider} isDisabled={isSaving}>
                            <ProviderLogo icon={modelInitializationPreset.icon} providerCatalog={providerCatalog} providerKey={modelInitializationPreset.key} size="sm" />
                            {modelInitializationPreset.name}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </Card.Content>
              </Card>
              <HermesModelSummary
                modelCatalog={modelCatalog}
                modelCount={stats.modelCount}
                primaryModel={primaryModel}
                primaryProvider={primaryProvider}
                providerCatalog={providerCatalog}
                providerCount={stats.providerCount}
                rawDefault={modelConfig.default}
                rawProvider={modelConfig.provider}
              />
            </section>

            {editorOpen ? (
              <ProviderEditorPanel
                editorModels={editorModels}
                fetchedModels={fetchedEditorModels}
                form={providerForm}
                hasFetchedModels={hasFetchedEditorModels}
                isFetchingModels={fetchingModels}
                isSaving={isSaving}
                mode={editorMode}
                providerPresets={providerPresets}
                providerCatalog={providerCatalog}
                modelCatalog={modelCatalog}
                testingModelId={testingModelId}
                onAddFetchedModel={(model) => setEditorModels((current) => mergeModels(current, [model]))}
                onAddManualModel={() => {
                  setAddModelTarget('editor')
                  setModelForm(emptyModelForm)
                  setAddModelOpen(true)
                }}
                onApplyPreset={(presetKey) => {
                  const preset = providerPresets.find((item) => item.key === presetKey)
                  if (!preset) {
                    setProviderForm((current) => ({ ...current, presetKey: '' }))
                    return
                  }
                  setProviderForm((current) => ({
                    ...current,
                    apiKey: preset.apiKey ?? current.apiKey,
                    apiMode: preset.apiMode,
                    baseUrl: preset.baseUrl,
                    defaultModel: preset.defaultModel ?? current.defaultModel,
                    key: preset.key,
                    keyEnv: preset.keyEnv ?? current.keyEnv,
                    name: preset.name,
                    presetKey,
                  }))
                  setEditorModels(preset.models)
                  setFetchedEditorModels([])
                  setHasFetchedEditorModels(false)
                }}
                onCancel={() => setEditorOpen(false)}
                onChange={(patch) => {
                  if ('apiKey' in patch || 'apiMode' in patch || 'baseUrl' in patch) {
                    setFetchedEditorModels([])
                    setHasFetchedEditorModels(false)
                  }
                  setProviderForm((current) => ({ ...current, ...patch }))
                }}
                onClearFetchedModels={() => {
                  setFetchedEditorModels([])
                  setHasFetchedEditorModels(false)
                }}
                onFetchModels={() => void fetchEditorModels()}
                onRemoveModel={(modelId) => setEditorModels((current) => current.filter((model) => model.id !== modelId))}
                onReplaceModels={(models) => setEditorModels(models)}
                onSubmit={submitProvider}
                onTestModel={(model) => void testEditorModel(model)}
              />
            ) : (
              <section className="flex flex-col gap-4">
                {providers.length ? (
                  <HermesProviderSegment
                    hasUnsavedChanges={hasUnsavedChanges}
                    isSaving={isSaving}
                    providerCatalog={providerCatalog}
                    providers={filteredProviders}
                    query={query}
                    selectedKey={selectedProvider?.key ?? ''}
                    state={state}
                    onCreate={openCreateProvider}
                    onOpenVisionSettings={() => setVisionSettingsOpen(true)}
                    onQueryChange={setQuery}
                    onRefresh={loadModels}
                    onSave={saveModels}
                    onSelectionChange={(key) => setSelectedProviderKey(String(key))}
                  />
                ) : null}
                {filteredProviders.length ? (
                  selectedProvider ? (
                    <ProviderDetail
                      fallbackProviders={fallbackProviders}
                      isSaving={isSaving}
                      modelCatalog={modelCatalog}
                      primaryModel={modelConfig}
                      providerCatalog={providerCatalog}
                      provider={selectedProvider}
                      testingModelId={testingModelId}
                      visionModel={auxiliaryVision}
                      onAddModel={() => {
                        setAddModelTarget('detail')
                        setModelForm(emptyModelForm)
                        setAddModelOpen(true)
                      }}
                      onDeleteModel={(modelId) => deleteModel(selectedProvider.key, modelId)}
                      onDeleteProvider={() => deleteProvider(selectedProvider.key)}
                      onEdit={() => openEditProvider(selectedProvider)}
                      onSetPrimary={(modelId) => setPrimaryModel(selectedProvider.key, modelId)}
                      onSetVision={(modelId) => setVisionModel(selectedProvider.key, modelId)}
                      onTestModel={(model) => void testModel(selectedProvider, model)}
                      onToggleFallback={(modelId) => toggleFallback(selectedProvider.key, modelId)}
                    />
                  ) : null
                ) : providers.length && query.trim() ? (
                  <EmptyPanel className="min-h-80" icon="lucide:search-x" text="没有匹配的 Provider" />
                ) : (
                  <EmptyProviderState isSaving={isSaving} onCreate={openCreateProvider} onRefresh={loadModels} state={state} />
                )}
              </section>
            )}

            <ModelAddDialog
              description="为当前 Hermes Provider 添加一个可路由模型。"
              form={modelForm}
              isOpen={addModelOpen}
              title="添加模型"
              onCancel={() => {
                setAddModelOpen(false)
                setModelForm(emptyModelForm)
              }}
              onChange={setModelForm}
              onSubmit={() => addModel(addModelTarget === 'detail' ? selectedProvider?.key : undefined)}
            />
            <VisionRoutingDialog
              agentSettings={agentSettings}
              auxiliaryVision={auxiliaryVision}
              isOpen={visionSettingsOpen}
              isSaving={isSaving}
              providers={providers}
              onAgentChange={(patch) => setAgentSettings((current) => normalizeAgentSettings({ ...current, ...patch }))}
              onCancel={() => setVisionSettingsOpen(false)}
              onVisionChange={(patch) => setAuxiliaryVision((current) => normalizeAuxiliaryVision({ ...current, ...patch }))}
            />
          </>
        ) : null}
      </div>
    </DashboardLayout>
  )
}

function HermesModelSummary({
  modelCatalog,
  modelCount,
  primaryModel,
  primaryProvider,
  providerCatalog,
  providerCount,
  rawDefault,
  rawProvider,
}: {
  modelCatalog: ModelCatalog
  modelCount: number
  primaryModel: HermesModelDefinition | null
  primaryProvider: ProviderDraft | null
  providerCatalog: ProviderCatalog
  providerCount: number
  rawDefault?: string
  rawProvider?: string
}) {
  const hasPrimaryModel = Boolean(primaryProvider && primaryModel)

  return (
    <Card className="h-full">
      <Card.Content>
        <div className="grid gap-3">
          <div className="rounded-2xl bg-surface-secondary/50 p-4">
            <div className="flex items-center gap-3">
              {hasPrimaryModel ? (
                <ModelLogo model={primaryModel as HermesModelDefinition} modelCatalog={modelCatalog} providerCatalog={providerCatalog} providerKey={(primaryProvider as ProviderDraft).key} size="md" />
              ) : (
                <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-muted">
                  <Icon icon="lucide:route-off" className="size-5" />
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-foreground">{primaryModel?.name || rawDefault || '未设置主模型'}</div>
                <div className="truncate font-mono text-xs text-muted">{rawProvider || primaryProvider?.key || 'provider 未设置'}{rawDefault ? ` / ${rawDefault}` : ''}</div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SummaryMetric icon="lucide:cloud-cog" label="Provider" value={providerCount} />
            <SummaryMetric icon="lucide:boxes" label="模型" value={modelCount} />
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function SummaryMetric({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-surface-secondary/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs text-muted">{label}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{numberFormatter.format(value)}</div>
        </div>
        <Icon icon={icon} className="size-5 shrink-0 text-muted" />
      </div>
    </div>
  )
}

function VisionRoutingDialog({
  agentSettings,
  auxiliaryVision,
  isOpen,
  isSaving,
  onAgentChange,
  onCancel,
  onVisionChange,
  providers,
}: {
  agentSettings: HermesAgentModelSettings
  auxiliaryVision: HermesAuxiliaryVisionConfig
  isOpen: boolean
  isSaving: boolean
  onAgentChange: (patch: Partial<HermesAgentModelSettings>) => void
  onCancel: () => void
  onVisionChange: (patch: Partial<HermesAuxiliaryVisionConfig>) => void
  providers: ProviderDraft[]
}) {
  return (
    <AlertDialog.Backdrop isOpen={isOpen} onOpenChange={(open) => {
      if (!open) onCancel()
    }}>
      <AlertDialog.Container>
        <AlertDialog.Dialog className="sm:max-w-[560px]">
          <AlertDialog.CloseTrigger />
          <AlertDialog.Header>
            <AlertDialog.Heading>视觉设置</AlertDialog.Heading>
            <p className="text-sm text-muted">指定图片预分析使用的 Provider 和模型。设置后，图片会先交给视觉模型，再把分析结果发送给主模型。</p>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <VisionRoutingPanel
              agentSettings={agentSettings}
              auxiliaryVision={auxiliaryVision}
              isSaving={isSaving}
              providers={providers}
              onAgentChange={onAgentChange}
              onVisionChange={onVisionChange}
            />
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button variant="primary" onPress={onCancel}>关闭</Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  )
}

function VisionRoutingPanel({
  agentSettings,
  auxiliaryVision,
  isSaving,
  onAgentChange,
  onVisionChange,
  providers,
}: {
  agentSettings: HermesAgentModelSettings
  auxiliaryVision: HermesAuxiliaryVisionConfig
  isSaving: boolean
  onAgentChange: (patch: Partial<HermesAgentModelSettings>) => void
  onVisionChange: (patch: Partial<HermesAuxiliaryVisionConfig>) => void
  providers: ProviderDraft[]
}) {
  const normalizedAgent = normalizeAgentSettings(agentSettings)
  const normalizedVision = normalizeAuxiliaryVision(auxiliaryVision)
  const selectedProvider = providers.find((provider) => provider.key === normalizedVision.provider)
  const modelOptions = selectedProvider?.models ?? []
  const selectedModel = modelOptions.find((model) => model.id === normalizedVision.model)

  return (
    <ItemCardGroup>
      <FragmentWithSeparator showSeparator={false}>
        <ProviderFormItem actionClassName="w-fit max-w-full" icon="lucide:image" title="图片输入模式">
          <ImageInputModeSelect
            value={normalizeImageInputMode(normalizedAgent.imageInputMode)}
            onChange={(value) => onAgentChange({ imageInputMode: normalizeImageInputMode(String(value ?? 'auto')) })}
          />
        </ProviderFormItem>
      </FragmentWithSeparator>
      <FragmentWithSeparator showSeparator>
        <ProviderFormItem actionClassName="w-fit max-w-full" icon="lucide:eye" title="Vision Provider">
          <VisionProviderSelect
            providers={providers}
            value={normalizedVision.provider || 'auto'}
            onChange={(value) => {
              const provider = String(value ?? 'auto')
              const nextProvider = providers.find((item) => item.key === provider)
              onVisionChange({
                apiMode: nextProvider?.apiMode || normalizedVision.apiMode,
                model: provider === normalizedVision.provider ? normalizedVision.model : nextProvider?.models?.find((model) => model.input?.includes('image'))?.id ?? nextProvider?.defaultModel ?? '',
                provider,
              })
            }}
          />
        </ProviderFormItem>
      </FragmentWithSeparator>
      <FragmentWithSeparator showSeparator>
        <ProviderFormItem actionClassName="w-fit max-w-full" icon="lucide:scan-eye" title="Vision 模型">
          <VisionModelSelect
            isDisabled={isSaving || !selectedProvider}
            models={modelOptions}
            selectedModel={selectedModel}
            value={normalizedVision.model || ''}
            onChange={(value) => onVisionChange({ model: String(value ?? '') })}
          />
        </ProviderFormItem>
      </FragmentWithSeparator>
      <FragmentWithSeparator showSeparator>
        <ProviderFormItem actionClassName="w-fit max-w-full" icon="lucide:route" title="Vision API Mode">
          <VisionApiModeSelect value={normalizedVision.apiMode || selectedProvider?.apiMode || 'chat_completions'} onChange={(value) => onVisionChange({ apiMode: normalizeApiMode(String(value ?? 'chat_completions')) })} />
        </ProviderFormItem>
      </FragmentWithSeparator>
      <FragmentWithSeparator showSeparator>
        <ProviderFormItem icon="lucide:link" title="Vision Base URL">
          <ProviderFormField ariaLabel="Vision Base URL">
            <InputGroup.Input disabled={isSaving} placeholder="https://api.example.com/v1" value={normalizedVision.baseUrl ?? ''} onChange={(event) => onVisionChange({ baseUrl: event.target.value })} />
          </ProviderFormField>
        </ProviderFormItem>
      </FragmentWithSeparator>
    </ItemCardGroup>
  )
}

function HermesProviderSegment({
  hasUnsavedChanges,
  isSaving,
  onCreate,
  onOpenVisionSettings,
  onQueryChange,
  onRefresh,
  onSave,
  onSelectionChange,
  providerCatalog,
  providers,
  query,
  selectedKey,
  state,
}: {
  hasUnsavedChanges: boolean
  isSaving: boolean
  onCreate: () => void
  onOpenVisionSettings: () => void
  onQueryChange: (value: string) => void
  onRefresh: () => void
  onSave: () => void
  onSelectionChange: (key: string | number) => void
  providerCatalog: ProviderCatalog
  providers: ProviderDraft[]
  query: string
  selectedKey: string
  state: LoadState
}) {
  return (
    <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
        {providers.map((provider) => {
          const isSelected = selectedKey === provider.key
          const label = providerDisplayName(provider.key, providerCatalog, provider.name)

          return isSelected ? (
            <Button
              key={provider.key}
              aria-pressed
              className="h-auto shrink-0 py-1 pl-1 pr-3"
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
              className="h-auto w-auto shrink-0 p-1"
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
        <SearchField variant="primary" className="sm:w-48" aria-label="搜索 Provider" value={query} onChange={onQueryChange}>
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="搜索..." />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        <Button variant="tertiary" onPress={onCreate} isDisabled={isSaving}>
          <Icon icon="lucide:plus" className="size-4" />
          添加
        </Button>
        <Button variant="tertiary" onPress={onOpenVisionSettings} isDisabled={isSaving}>
          <Icon icon="lucide:eye" className="size-4" />
          视觉设置
        </Button>
        {hasUnsavedChanges || isSaving ? (
          <Button variant="primary" onPress={onSave} isDisabled={isSaving}>
            <Icon icon={isSaving ? 'lucide:loader-circle' : 'lucide:save'} className={isSaving ? 'animate-spin' : 'size-4'} />
            保存
          </Button>
        ) : null}
        <Button isIconOnly variant={state === 'loading' ? 'danger' : 'ghost'} onPress={onRefresh} isDisabled={state === 'loading' || isSaving} aria-label="刷新 Hermes 模型配置">
          <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'animate-spin' : ''} />
        </Button>
      </div>
    </section>
  )
}

function EmptyProviderState({ isSaving, onCreate, onRefresh, state }: { isSaving: boolean; onCreate: () => void; onRefresh: () => void; state: LoadState }) {
  return (
    <div className="flex min-h-80 flex-col items-center justify-center rounded-2xl bg-surface-secondary/50 p-6 text-center">
      <Icon icon="lucide:box" className="size-8 text-muted" />
      <h3 className="mt-3 text-base font-semibold text-foreground">还没有 Provider</h3>
      <p className="mt-1 text-sm text-muted">新增一个 Provider 后，就可以配置模型、主模型和备用模型。</p>
      <div className="mt-4 flex items-center gap-3">
        <Button size="sm" variant="primary" onPress={onCreate} isDisabled={isSaving}>
          <Icon icon="lucide:plus" className="size-4" />
          添加服务商
        </Button>
        <Button isIconOnly variant="tertiary" aria-label="重新加载 Hermes 模型配置" size="sm" onPress={onRefresh} isDisabled={state === 'loading'}>
          <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'size-4 animate-spin' : 'size-4'} />
        </Button>
      </div>
    </div>
  )
}

function ProviderDetail({
  fallbackProviders,
  isSaving,
  modelCatalog,
  primaryModel,
  providerCatalog,
  provider,
  testingModelId,
  visionModel,
  onAddModel,
  onDeleteModel,
  onDeleteProvider,
  onEdit,
  onSetPrimary,
  onSetVision,
  onTestModel,
  onToggleFallback,
}: {
  fallbackProviders: HermesFallbackProvider[]
  isSaving: boolean
  modelCatalog: ModelCatalog
  primaryModel: HermesModelsResponse['model']
  providerCatalog: ProviderCatalog
  provider: ProviderDraft
  testingModelId: string
  visionModel: HermesAuxiliaryVisionConfig
  onAddModel: () => void
  onDeleteModel: (modelId: string) => void
  onDeleteProvider: () => void
  onEdit: () => void
  onSetPrimary: (modelId: string) => void
  onSetVision: (modelId: string) => void
  onTestModel: (model: HermesModelDefinition) => void
  onToggleFallback: (modelId: string) => void
}) {
  const models = useMemo(() => {
    return [...(provider.models ?? [])].sort((left, right) => {
      const leftIsPrimary = primaryModel.provider === provider.key && primaryModel.default === left.id
      const rightIsPrimary = primaryModel.provider === provider.key && primaryModel.default === right.id
      if (leftIsPrimary === rightIsPrimary) return 0
      return leftIsPrimary ? -1 : 1
    })
  }, [primaryModel.default, primaryModel.provider, provider.key, provider.models])

  return (
    <Card>
      <Card.Header className="flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3 text-left">
          <ProviderLogo providerCatalog={providerCatalog} providerKey={provider.key} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Card.Title>{providerDisplayName(provider.key, providerCatalog, provider.name)}</Card.Title>
              <Chip size="sm" variant="soft">{models.length} 模型</Chip>
              <Chip size="sm" variant="soft">{provider.apiMode || 'chat_completions'}</Chip>
            </div>
            <Card.Description className="truncate">{provider.baseUrl || '未配置 Base URL'}</Card.Description>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button size="sm" variant="tertiary" onPress={onAddModel} isDisabled={isSaving}>
            <Icon icon="lucide:plus" />
            添加
          </Button>
          <Button size="sm" variant="tertiary" onPress={onEdit} isDisabled={isSaving}>
            <Icon icon="lucide:pencil" />
            编辑
          </Button>
          <Button size="sm" variant="danger" isIconOnly onPress={onDeleteProvider} isDisabled={isSaving} aria-label="删除 Provider">
            <Icon icon="lucide:trash-2" />
          </Button>
        </div>
      </Card.Header>
      <Card.Content>
        <div className="flex flex-col gap-4">
          {models.length ? (
            <div className="overflow-x-auto rounded-2xl">
              <table className="w-full min-w-[880px] text-left text-sm">
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
                    const isPrimary = primaryModel.provider === provider.key && primaryModel.default === model.id
                    const isFallback = fallbackProviders.some((fallback) => fallback.provider === provider.key && fallback.model === model.id)
                    const isVision = visionModel.provider === provider.key && visionModel.model === model.id
                    const isTesting = testingModelId === `${provider.key}/${model.id}`
                    return (
                      <tr key={`${model.id}-${index}`} className="bg-background align-middle">
                        <td className="px-4 py-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <ModelLogo model={model} modelCatalog={modelCatalog} providerCatalog={providerCatalog} providerKey={provider.key} size="sm" />
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-foreground">{model.name || titleizeModel(model.id)}</p>
                              <p className="mt-1 truncate font-mono text-xs text-muted">{model.id}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <ModelAbilityIcons model={model} />
                        </td>
                        <td className="px-4 py-3 text-sm text-muted">{formatContext(model.contextLength || model.contextWindow)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {isPrimary ? <Chip size="sm" variant="primary">主模型</Chip> : null}
                            {isVision ? <Chip size="sm" variant="soft">视觉模型</Chip> : null}
                            {!isPrimary && isFallback ? <Chip size="sm" variant="soft">Fallback</Chip> : null}
                            {!isPrimary && !isFallback && !isVision ? <span className="text-xs text-muted">未加入默认路由</span> : null}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <Tooltip delay={300}>
                              <Button size="sm" variant="tertiary" isIconOnly aria-label="测试模型" onPress={() => onTestModel(model)} isDisabled={isTesting || isSaving}>
                                <Icon icon={isTesting ? 'lucide:loader-circle' : 'lucide:activity'} className={isTesting ? 'animate-spin' : ''} />
                              </Button>
                              <Tooltip.Content>{isTesting ? '正在测试模型' : '测试模型'}</Tooltip.Content>
                            </Tooltip>
                            {!isPrimary ? (
                              <Tooltip delay={300}>
                                <Button isIconOnly size="sm" variant="tertiary" aria-label="设为主模型" onPress={() => onSetPrimary(model.id)} isDisabled={isSaving}>
                                  <Icon icon="lucide:brain" className="size-4" />
                                </Button>
                                <Tooltip.Content>设为主模型</Tooltip.Content>
                              </Tooltip>
                            ) : null}
                            <Tooltip delay={300}>
                              <Button isIconOnly size="sm" variant={isVision ? 'primary' : 'tertiary'} aria-label={isVision ? '当前视觉模型' : '设为视觉模型'} onPress={() => onSetVision(model.id)} isDisabled={isSaving || isVision}>
                                <Icon icon={isVision ? 'lucide:eye' : 'lucide:eye-off'} className="size-4" />
                              </Button>
                              <Tooltip.Content>{isVision ? '当前视觉模型' : '设为视觉模型'}</Tooltip.Content>
                            </Tooltip>
                            <Tooltip delay={300}>
                              <Button isIconOnly size="sm" variant="tertiary" aria-label={isFallback ? '移出 Fallback' : '加入 Fallback'} onPress={() => onToggleFallback(model.id)} isDisabled={isPrimary || isSaving}>
                                <Icon icon={isFallback ? 'lucide:circle-slash' : 'lucide:circle-fading-arrow-up'} className="size-4" />
                              </Button>
                              <Tooltip.Content>{isPrimary ? '主模型不可设为 Fallback' : isFallback ? '移出 Fallback' : '加入 Fallback'}</Tooltip.Content>
                            </Tooltip>
                            <Tooltip delay={300}>
                              <Button isIconOnly size="sm" variant="ghost" aria-label="删除模型" onPress={() => onDeleteModel(model.id)} isDisabled={isSaving}>
                                <Icon icon="lucide:trash-2" className="size-4" />
                              </Button>
                              <Tooltip.Content>删除模型</Tooltip.Content>
                            </Tooltip>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyPanel className="min-h-80" icon="lucide:box" text="这个 Provider 还没有模型。可以手动添加，或从服务商拉取 /models。" />
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <ProviderMeta label="Provider ID" value={provider.key} />
            <ProviderMeta label="默认模型" value={provider.defaultModel || provider.model || '-'} />
            <ProviderMeta label="Key Env" value={provider.keyEnv || '-'} />
            <ProviderMeta label="API Key" value={provider.apiKey ? '已配置' : '-'} />
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function ModelAbilityIcons({ model }: { model: HermesModelDefinition }) {
  const supportsText = !model.input?.length || model.input.includes('text')
  const abilities = [
    supportsText ? { icon: 'lucide:file-text', label: 'Text' } : null,
    model.reasoning ? { icon: 'lucide:brain-circuit', label: 'Reasoning' } : null,
    model.input?.includes('image') ? { icon: 'lucide:eye', label: 'Vision' } : null,
  ].filter(Boolean) as Array<{ icon: string; label: string }>

  return (
    <div className="flex flex-wrap gap-1.5">
      {abilities.map((ability) => (
        <span
          key={ability.label}
          aria-label={ability.label}
          className="flex size-7 items-center justify-center rounded-full bg-surface-secondary/50 text-muted"
          title={ability.label}
        >
          <Icon icon={ability.icon} className="size-4" />
        </span>
      ))}
    </div>
  )
}

function ProviderMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface-secondary/50 p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-2 break-words text-sm font-medium text-foreground [overflow-wrap:anywhere]">{value}</div>
    </div>
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

function ProviderEditorPanel({
  editorModels,
  fetchedModels,
  form,
  hasFetchedModels,
  isFetchingModels,
  isSaving,
  modelCatalog,
  mode,
  providerCatalog,
  providerPresets,
  testingModelId,
  onAddFetchedModel,
  onAddManualModel,
  onApplyPreset,
  onCancel,
  onChange,
  onClearFetchedModels,
  onFetchModels,
  onRemoveModel,
  onReplaceModels,
  onSubmit,
  onTestModel,
}: {
  editorModels: HermesModelDefinition[]
  fetchedModels: HermesModelDefinition[]
  form: ProviderFormState
  hasFetchedModels: boolean
  isFetchingModels: boolean
  isSaving: boolean
  modelCatalog: ModelCatalog
  mode: ProviderEditorMode
  providerCatalog: ProviderCatalog
  providerPresets: HermesProviderPreset[]
  testingModelId: string
  onAddFetchedModel: (model: HermesModelDefinition) => void
  onAddManualModel: () => void
  onApplyPreset: (presetKey: string) => void
  onCancel: () => void
  onChange: (patch: Partial<ProviderFormState>) => void
  onClearFetchedModels: () => void
  onFetchModels: () => void
  onRemoveModel: (modelId: string) => void
  onReplaceModels: (models: HermesModelDefinition[]) => void
  onSubmit: () => void
  onTestModel: (model: HermesModelDefinition) => void
}) {
  const fetchedCandidateModels = fetchedModels.filter((model) => model.id && !editorModels.some((current) => current.id === model.id))
  const canFetchModels = Boolean(form.baseUrl.trim())
  const canReplaceModels = hasFetchedModels && fetchedModels.length > 0
  const canSubmitProvider = Boolean(form.key.trim())
  const selectedPreset = providerPresets.find((preset) => sameProviderKey(preset.key, form.presetKey))
  const providerMatchedPreset = providerPresets.find((preset) => sameProviderKey(preset.key, form.key))
  const displayPreset = selectedPreset ?? providerMatchedPreset
  const canUpdateFromPresetModels = Boolean(displayPreset && !modelsEquivalent(editorModels, displayPreset.models))
  const previewProviderKey = toProviderKey(form.key) || selectedPreset?.key || 'provider'
  const previewProviderName = form.name.trim() || selectedPreset?.name || providerDisplayName(previewProviderKey, providerCatalog)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface p-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-soft-foreground">
            <Icon icon={mode === 'create' ? 'lucide:plus' : 'lucide:pencil'} className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="text-base font-medium text-foreground">{mode === 'create' ? '新增 Provider' : '编辑 Provider'}</div>
            <div className="text-xs text-muted">先整理 Provider 与模型草稿，再写回列表。</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" isIconOnly variant="primary" onPress={onCancel} isDisabled={isSaving}>
            <Icon icon="lucide:x" />
          </Button>
          {canSubmitProvider ? (
            <Button size="sm" variant="primary" onPress={onSubmit} isDisabled={isSaving}>
              <Icon icon={isSaving ? 'lucide:loader-circle' : 'lucide:save'} className={isSaving ? 'animate-spin' : ''} />
              {mode === 'create' ? '创建' : '保存'}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(520px,520px)_minmax(0,1fr)]">

        <ItemCardGroup className="overflow-hidden">
          <FragmentWithSeparator showSeparator={false}>
            <ProviderFormItem actionClassName="w-fit max-w-full" description="从远程模型目录带入服务商信息" icon="lucide:wand-sparkles" title="预设模板">
              <ProviderPresetSelect
                presets={providerPresets}
                providerCatalog={providerCatalog}
                value={form.presetKey || manualPresetKey}
                onChange={(value) => onApplyPreset(value === manualPresetKey ? '' : String(value ?? ''))}
              />
            </ProviderFormItem>
          </FragmentWithSeparator>
          <FragmentWithSeparator showSeparator>
            <ProviderFormItem actionClassName="w-fit max-w-full" description="Hermes 请求适配模式" icon="lucide:route" title="API Mode">
              <ApiModeSelect value={form.apiMode} onChange={(value) => onChange({ apiMode: normalizeApiMode(String(value)) })} />
            </ProviderFormItem>
          </FragmentWithSeparator>
          <FragmentWithSeparator showSeparator>
            <ProviderFormItem description="用于 providers 映射键" icon="lucide:fingerprint" title="Provider ID">
              <ProviderFormField ariaLabel="Provider ID">
                <InputGroup.Input placeholder="openrouter" value={form.key} onChange={(event) => onChange({ key: event.target.value })} />
              </ProviderFormField>
            </ProviderFormItem>
          </FragmentWithSeparator>
          <FragmentWithSeparator showSeparator>
            <ProviderFormItem description="Dashboard 展示名称" icon="lucide:tag" title="显示名称">
              <ProviderFormField ariaLabel="显示名称">
                <InputGroup.Input placeholder="OpenRouter" value={form.name} onChange={(event) => onChange({ name: event.target.value })} />
              </ProviderFormField>
            </ProviderFormItem>
          </FragmentWithSeparator>
          <FragmentWithSeparator showSeparator>
            <ProviderFormItem description="Provider 默认模型" icon="lucide:star" title="默认模型">
              <ProviderFormField ariaLabel="默认模型">
                <InputGroup.Input placeholder="gpt-5.5" value={form.defaultModel} onChange={(event) => onChange({ defaultModel: event.target.value })} />
              </ProviderFormField>
            </ProviderFormItem>
          </FragmentWithSeparator>
          <FragmentWithSeparator showSeparator>
            <ProviderFormItem description="模型服务接口地址" icon="lucide:link" title="Base URL">
              <ProviderFormField ariaLabel="Base URL">
                <InputGroup.Input placeholder="https://api.example.com/v1" value={form.baseUrl} onChange={(event) => onChange({ baseUrl: event.target.value })} />
              </ProviderFormField>
            </ProviderFormItem>
          </FragmentWithSeparator>
          <FragmentWithSeparator showSeparator>
            <ProviderFormItem description="直接写入 config.yaml" icon="lucide:key-round" title="API Key">
              <ProviderFormField ariaLabel="API Key">
                <InputGroup.Input placeholder="sk-..." value={form.apiKey} onChange={(event) => onChange({ apiKey: event.target.value })} />
              </ProviderFormField>
            </ProviderFormItem>
          </FragmentWithSeparator>
          <FragmentWithSeparator showSeparator>
            <ProviderFormItem description="运行时读取的环境变量名" icon="lucide:key-round" title="Key Env">
              <ProviderFormField ariaLabel="Key Env">
                <InputGroup.Input placeholder="OPENROUTER_API_KEY" value={form.keyEnv} onChange={(event) => onChange({ keyEnv: event.target.value })} />
              </ProviderFormField>
            </ProviderFormItem>
          </FragmentWithSeparator>
          <FragmentWithSeparator showSeparator>
            <ProviderFormItem description="请求等待秒数" icon="lucide:timer" title="请求超时">
              <ProviderFormField ariaLabel="请求超时秒数">
                <InputGroup.Input placeholder="120" value={form.requestTimeoutSeconds} onChange={(event) => onChange({ requestTimeoutSeconds: event.target.value })} />
              </ProviderFormField>
            </ProviderFormItem>
          </FragmentWithSeparator>
          <FragmentWithSeparator showSeparator>
            <ProviderFormItem description="凭据缓存过期秒数" icon="lucide:clock-3" title="凭据过期">
              <ProviderFormField ariaLabel="凭据过期秒数">
                <InputGroup.Input placeholder="3600" value={form.staleTimeoutSeconds} onChange={(event) => onChange({ staleTimeoutSeconds: event.target.value })} />
              </ProviderFormField>
            </ProviderFormItem>
          </FragmentWithSeparator>
        </ItemCardGroup>

        {displayPreset?.docsUrl || displayPreset?.apiKeyUrl || displayPreset?.buttons?.length || canUpdateFromPresetModels ? (
          <ItemCardGroup className="overflow-hidden">
            {displayPreset?.docsUrl ? (
              <FragmentWithSeparator showSeparator={false}>
                <ProviderLinkItem
                  description="打开服务商模型与接口文档。"
                  icon="lucide:book-open"
                  label="文档"
                  onPress={() => void openExternalUrl(displayPreset.docsUrl)}
                />
              </FragmentWithSeparator>
            ) : null}
            {displayPreset?.apiKeyUrl ? (
              <FragmentWithSeparator showSeparator={Boolean(displayPreset?.docsUrl)}>
                <ProviderLinkItem
                  description="打开服务商控制台 API Key 页面。"
                  icon="lucide:key-round"
                  label="获取 API Key"
                  onPress={() => void openExternalUrl(displayPreset.apiKeyUrl)}
                />
              </FragmentWithSeparator>
            ) : null}
            {displayPreset?.buttons?.map((button, index) => (
              <FragmentWithSeparator key={`${button.label}-${button.link}`} showSeparator={Boolean(displayPreset.docsUrl || displayPreset.apiKeyUrl || index > 0)}>
                <ProviderLinkItem
                  description={displayPreset.description || `打开 ${displayPreset.name} 相关页面。`}
                  icon="lucide:globe"
                  label={button.label}
                  onPress={() => void openExternalUrl(button.link)}
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
                  onPress={() => onReplaceModels(displayPreset.models.map((model) => ({ ...model })))}
                />
              </FragmentWithSeparator>
            ) : null}
          </ItemCardGroup>
        ) : null}

        <Card className="flex max-h-[calc(100dvh-300px)] min-h-[520px] min-w-0 flex-col">
          <Card.Header className="flex-row items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <ProviderLogo icon={selectedPreset?.icon} providerCatalog={providerCatalog} providerKey={previewProviderKey} />
              <div className="min-w-0">
                <Card.Title>{previewProviderName}</Card.Title>
                <Card.Description className="truncate">{editorModels.length} 个已添加模型{hasFetchedModels ? `，${fetchedCandidateModels.length} 个候选` : ''}</Card.Description>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {canReplaceModels ? (
                <Button size="sm" variant="tertiary" onPress={() => onReplaceModels(fetchedModels)} isDisabled={isSaving}>
                  <Icon icon="lucide:replace" />
                  替换为获取结果
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onPress={hasFetchedModels ? onClearFetchedModels : onFetchModels} isDisabled={!canFetchModels || isFetchingModels || isSaving}>
                <Icon icon={isFetchingModels ? 'lucide:loader-circle' : hasFetchedModels ? 'lucide:x' : 'lucide:download-cloud'} className={isFetchingModels ? 'animate-spin' : ''} />
                {hasFetchedModels ? '清除结果' : '获取模型'}
              </Button>
              <Button size="sm" variant="primary" onPress={onAddManualModel} isDisabled={isSaving}>
                <Icon icon="lucide:plus" />
                添加模型
              </Button>
            </div>
          </Card.Header>
          <Card.Content className="min-h-0 flex-1">
            <div className={hasFetchedModels ? 'grid h-full min-h-0 gap-3 lg:grid-cols-2' : 'grid h-full min-h-0 gap-3'}>
              <ModelDraftList
                emptyText="暂无已添加模型"
                models={editorModels}
                modelCatalog={modelCatalog}
                providerCatalog={providerCatalog}
                providerKey={previewProviderKey}
                title="已添加模型"
                renderAction={(model) => (
                  <>
                    <Button size="sm" variant="ghost" isIconOnly aria-label="测试模型" onPress={() => onTestModel(model)} isDisabled={testingModelId === `editor/${model.id}` || isSaving}>
                      <Icon icon={testingModelId === `editor/${model.id}` ? 'lucide:loader-circle' : 'lucide:activity'} className={testingModelId === `editor/${model.id}` ? 'animate-spin' : ''} />
                    </Button>
                    <Button size="sm" variant="ghost" isIconOnly aria-label="移除模型" onPress={() => onRemoveModel(model.id)} isDisabled={isSaving}>
                      <Icon icon="lucide:trash-2" />
                    </Button>
                  </>
                )}
              />
              {hasFetchedModels ? (
                <ModelDraftList
                  emptyText="没有新的候选模型"
                  models={fetchedCandidateModels}
                  modelCatalog={modelCatalog}
                  providerCatalog={providerCatalog}
                  providerKey={previewProviderKey}
                  title="获取结果"
                  renderAction={(model) => (
                    <Button size="sm" variant="ghost" isIconOnly aria-label="添加候选模型" onPress={() => onAddFetchedModel(model)} isDisabled={isSaving}>
                      <Icon icon="lucide:plus" />
                    </Button>
                  )}
                />
              ) : null}
            </div>
          </Card.Content>
        </Card>
      </div>
    </div>
  )
}

function ModelDraftList({
  emptyText,
  modelCatalog,
  models,
  providerCatalog,
  providerKey,
  renderAction,
  title,
}: {
  emptyText: string
  modelCatalog: ModelCatalog
  models: HermesModelDefinition[]
  providerCatalog: ProviderCatalog
  providerKey: string
  renderAction: (model: HermesModelDefinition) => React.ReactNode
  title: string
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <div className="mb-2 shrink-0 text-sm font-medium text-foreground">{title}</div>
      {models.length ? (
        <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto">
          {models.map((model) => (
            <div key={model.id} className="flex min-w-0 items-center gap-3 rounded-2xl bg-surface-secondary/50 px-3 py-2">
              <ModelLogo model={model} modelCatalog={modelCatalog} providerCatalog={providerCatalog} providerKey={providerKey} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{model.name || titleizeModel(model.id)}</p>
                <p className="mt-0.5 truncate font-mono text-xs text-muted">{model.id}</p>
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
                {renderAction(model)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyPanel className="min-h-64 flex-1" icon="lucide:boxes" text={emptyText} />
      )}
    </div>
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
  form: ModelFormState
  isOpen: boolean
  onCancel: () => void
  onChange: React.Dispatch<React.SetStateAction<ModelFormState>>
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
                      placeholder="gpt-5.5"
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
                      placeholder="GPT 5.5"
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
                      value={form.contextLength}
                      onChange={(event) => onChange((current) => ({ ...current, contextLength: event.target.value }))}
                    />
                  </InputGroup>
                </TextField>
                <TextField fullWidth name="model-max-tokens">
                  <Label>最大输出（选填）</Label>
                  <InputGroup fullWidth variant="secondary">
                    <InputGroup.Prefix>
                      <Icon icon="lucide:hash" className="size-4 text-muted" />
                    </InputGroup.Prefix>
                    <InputGroup.Input
                      inputMode="numeric"
                      placeholder="例如 8192"
                      value={form.maxTokens}
                      onChange={(event) => onChange((current) => ({ ...current, maxTokens: event.target.value }))}
                    />
                  </InputGroup>
                </TextField>
                <div className="flex items-center justify-between gap-4 rounded-2xl border border-divider bg-surface-tertiary px-4 py-3">
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

function ProviderFormItem({
  actionClassName = 'w-full min-w-0 sm:w-64',
  children,
  description,
  icon,
  title,
}: {
  actionClassName?: string
  children: React.ReactNode
  description?: string
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
        {description ? <ItemCard.Description>{description}</ItemCard.Description> : null}
      </ItemCard.Content>
      <ItemCard.Action>
        <div className={actionClassName}>{children}</div>
      </ItemCard.Action>
    </ItemCard>
  )
}

function ProviderFormField({ ariaLabel, children }: { ariaLabel: string; children: React.ReactNode }) {
  return (
    <TextField aria-label={ariaLabel} fullWidth>
      <InputGroup fullWidth variant="secondary">
        {children}
      </InputGroup>
    </TextField>
  )
}

function FragmentWithSeparator({ children, showSeparator }: { children: React.ReactNode; showSeparator: boolean }) {
  return (
    <>
      {showSeparator ? <div className="h-px bg-border" /> : null}
      {children}
    </>
  )
}

function ProviderPresetSelect({
  onChange,
  presets,
  providerCatalog,
  value,
}: {
  onChange: (value: Key | null) => void
  presets: HermesProviderPreset[]
  providerCatalog: ProviderCatalog
  value: Key | null
}) {
  const selectedKey = String(value ?? manualPresetKey)
  const selectedPreset = presets.find((preset) => sameProviderKey(preset.key, selectedKey))

  return (
    <div>
      <CellSelect aria-label="预设模板" value={value} variant="secondary" onChange={onChange}>
        <CellSelect.Trigger>
          <CellSelect.Value>
            {() => selectedPreset ? (
              <span className="flex min-w-0 items-center justify-end gap-2 text-end">
                <ProviderLogo icon={selectedPreset.icon} providerCatalog={providerCatalog} providerKey={selectedPreset.key} size="sm" />
                <span className="truncate font-semibold">{selectedPreset.name}</span>
                <span className="text-xs text-muted">{selectedPreset.models.length} 模型</span>
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
    </div>
  )
}

function ApiModeSelect({ value, onChange }: { value: string; onChange: (value: Key | null) => void }) {
  const selectedValue = value || 'chat_completions'

  return (
    <CellSelect aria-label="API Mode" value={selectedValue} variant="secondary" onChange={onChange}>
      <CellSelect.Trigger>
        <CellSelect.Value>
          {() => (
            <span className="flex min-w-0 items-center justify-end gap-2 text-end">
              <Icon icon={apiModeIcon(normalizeApiMode(selectedValue))} className="size-4 text-muted" />
              <span className="truncate font-semibold">{selectedValue}</span>
            </span>
          )}
        </CellSelect.Value>
        <CellSelect.Indicator />
      </CellSelect.Trigger>
      <CellSelect.Popover>
        <ListBox>
          {apiModeOptions.map((option) => (
            <ListBox.Item key={option} id={option} textValue={option}>
              <Icon icon={apiModeIcon(option)} className="size-4 text-muted" />
              {option}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </CellSelect.Popover>
    </CellSelect>
  )
}

function ImageInputModeSelect({ value, onChange }: { value: HermesImageInputMode; onChange: (value: Key | null) => void }) {
  const labels: Record<HermesImageInputMode, string> = {
    auto: '自动',
    native: '直传主模型',
    text: '视觉预分析',
  }
  const descriptions: Record<HermesImageInputMode, string> = {
    auto: '由 Hermes 判断',
    native: '图片直传主模型',
    text: '图片先给视觉模型',
  }
  const selectedValue = normalizeImageInputMode(value)

  return (
    <Dropdown>
      <Button aria-label="图片输入模式" className="justify-between" variant="tertiary">
        <span className="flex min-w-0 items-center gap-2">
          <Icon icon={imageInputModeIcon(selectedValue)} className="size-4 text-muted" />
          <span className="truncate font-semibold">{labels[selectedValue]}</span>
        </span>
        <Icon icon="lucide:chevron-down" className="size-4 shrink-0 text-muted" />
      </Button>
      <Dropdown.Popover className="w-auto">
        <Dropdown.Menu selectedKeys={new Set([selectedValue])} selectionMode="single" onAction={(key) => onChange(key)}>
          {imageInputModeOptions.map((option) => (
            <Dropdown.Item key={option} id={option} textValue={labels[option]}>
              <Dropdown.ItemIndicator type="dot" />
              <DropdownItemContent description={descriptions[option]} icon={imageInputModeIcon(option)} label={labels[option]} />
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

function VisionProviderSelect({ providers, value, onChange }: { providers: ProviderDraft[]; value: string; onChange: (value: Key | null) => void }) {
  const selectedProvider = providers.find((provider) => provider.key === value)
  const selectedLabel = selectedProvider?.name || selectedProvider?.key || 'Auto'

  return (
    <Dropdown>
      <Button aria-label="Vision Provider" className="justify-between" variant="tertiary">
        <span className="flex min-w-0 items-center gap-2">
          <Icon icon={selectedProvider ? 'lucide:cloud-cog' : 'lucide:sparkles'} className="size-4 text-muted" />
          <span className="truncate font-semibold">{selectedLabel}</span>
        </span>
        <Icon icon="lucide:chevron-down" className="size-4 shrink-0 text-muted" />
      </Button>
      <Dropdown.Popover className="min-w-80">
        <Dropdown.Menu selectedKeys={new Set([value || 'auto'])} selectionMode="single" onAction={(key) => onChange(key)}>
          <Dropdown.Item id="auto" textValue="Auto">
            <Dropdown.ItemIndicator type="dot" />
            <DropdownItemContent description="由 Hermes 自动选择" icon="lucide:sparkles" label="Auto" />

          </Dropdown.Item>
          {providers.map((provider) => (
            <Dropdown.Item key={provider.key} id={provider.key} textValue={provider.name || provider.key}>
              <Dropdown.ItemIndicator type="dot" />
              <DropdownItemContent description={provider.key} icon="lucide:cloud-cog" label={provider.name || provider.key} />
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

function VisionModelSelect({ isDisabled, models, onChange, selectedModel, value }: { isDisabled: boolean; models: HermesModelDefinition[]; onChange: (value: Key | null) => void; selectedModel?: HermesModelDefinition; value: string }) {
  const selectedKey = value || visionDefaultModelKey

  return (
    <Dropdown>
      <Button aria-label="Vision 模型" className="justify-between" isDisabled={isDisabled} variant="tertiary">
        <span className="flex min-w-0 items-center gap-2">
          <Icon icon={selectedModel?.input?.includes('image') ? 'lucide:eye' : 'lucide:box'} className="size-4 text-muted" />
          <span className="truncate font-semibold">{selectedModel?.name || value || 'Provider 默认'}</span>
        </span>
        <Icon icon="lucide:chevron-down" className="size-4 shrink-0 text-muted" />
      </Button>
      <Dropdown.Popover className="min-w-96">
        <Dropdown.Menu selectedKeys={new Set([selectedKey])} selectionMode="single" onAction={(key) => onChange(String(key) === visionDefaultModelKey ? '' : key)}>
          <Dropdown.Item id={visionDefaultModelKey} textValue="Provider 默认">
            <DropdownItemContent description="使用 Provider 默认模型" icon="lucide:sparkles" label="Provider 默认" />
            <Dropdown.ItemIndicator />
          </Dropdown.Item>
          {models.map((model) => (
            <Dropdown.Item key={model.id} id={model.id} textValue={model.name || model.id}>
              <Dropdown.ItemIndicator type="dot" />
              <DropdownItemContent description={model.id} icon={model.input?.includes('image') ? 'lucide:eye' : 'lucide:box'} label={model.name || model.id} />

            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

function VisionApiModeSelect({ value, onChange }: { value: string; onChange: (value: Key | null) => void }) {
  const selectedValue = normalizeApiMode(value)

  return (
    <Dropdown>
      <Button aria-label="Vision API Mode" className="justify-between" variant="tertiary">
        <span className="flex min-w-0 items-center gap-2">
          <Icon icon={apiModeIcon(selectedValue)} className="size-4 text-muted" />
          <span className="truncate font-semibold">{selectedValue}</span>
        </span>
        <Icon icon="lucide:chevron-down" className="size-4 shrink-0 text-muted" />
      </Button>
      <Dropdown.Popover className="min-w-80">
        <Dropdown.Menu selectedKeys={new Set([selectedValue])} selectionMode="single" onAction={(key) => onChange(key)}>
          {apiModeOptions.map((option) => (
            <Dropdown.Item key={option} id={option} textValue={option}>
              <Dropdown.ItemIndicator type="dot" />
              <DropdownItemContent description={apiModeDescription(option)} icon={apiModeIcon(option)} label={option} />
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

function DropdownItemContent({ description, icon, label }: { description: string; icon: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon icon={icon} className="size-4 shrink-0 text-muted" />
      <div className="flex min-w-0 flex-col">
        <Label className="truncate">{label}</Label>
        <Description className="truncate">{description}</Description>
      </div>
    </div>
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
  model: HermesModelDefinition
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

function EmptyPanel({ className = '', icon, text }: { className?: string; icon: string; text: string }) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-2xl bg-surface-secondary/50 p-6 text-center text-sm text-muted ${className}`}>
      <Icon icon={icon} className="mb-2 size-6" />
      {text}
    </div>
  )
}

function ModelsSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-36 rounded-2xl" />
      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Skeleton className="h-96 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    </div>
  )
}

function responseProvidersToDrafts(response: HermesModelsResponse) {
  return Object.entries(response.providers ?? {})
    .map(([key, provider]) => ({ ...provider, key: normalizeHermesProviderKey(key) }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

function stripProvider(provider: ProviderDraft): HermesModelProvider {
  const { key: _key, ...rest } = provider
  void _key
  return rest
}

function fingerprint(model: HermesModelsResponse['model'], providers: ProviderDraft[], fallbacks: HermesFallbackProvider[], credentialPoolStrategies?: Record<string, unknown>, agent?: HermesAgentModelSettings, auxiliaryVision?: HermesAuxiliaryVisionConfig) {
  return JSON.stringify({
    agent: normalizeAgentSettings(agent),
    auxiliaryVision: normalizeAuxiliaryVision(auxiliaryVision),
    credentialPoolStrategies: credentialPoolStrategies ?? {},
    fallbacks,
    model,
    providers: providers.map((provider) => [provider.key, stripProvider(provider)]),
  })
}

function normalizeAgentSettings(settings?: HermesAgentModelSettings | null): HermesAgentModelSettings {
  return {
    imageInputMode: normalizeImageInputMode(settings?.imageInputMode),
  }
}

function normalizeAuxiliaryVision(config?: HermesAuxiliaryVisionConfig | null): HermesAuxiliaryVisionConfig {
  return {
    apiKey: config?.apiKey ?? '',
    apiMode: config?.apiMode ?? '',
    baseUrl: config?.baseUrl ?? '',
    downloadTimeout: config?.downloadTimeout || 30,
    extraBody: config?.extraBody ?? {},
    model: config?.model ?? '',
    provider: normalizeHermesProviderKey(config?.provider?.trim() || 'auto'),
    timeout: config?.timeout || 120,
  }
}

function normalizeModelConfigProvider(config: HermesModelsResponse['model']): HermesModelsResponse['model'] {
  return {
    ...config,
    provider: normalizeHermesProviderKey(config?.provider ?? ''),
  }
}

function normalizeFallbackProviderKeys(fallbacks: HermesFallbackProvider[]) {
  return fallbacks.map((fallback) => ({
    ...fallback,
    provider: normalizeHermesProviderKey(fallback.provider),
  }))
}

function normalizeImageInputMode(value?: string): HermesImageInputMode {
  return imageInputModeOptions.includes(value as HermesImageInputMode) ? value as HermesImageInputMode : 'auto'
}

function providerSearchText(provider: ProviderDraft) {
  return [
    provider.key,
    provider.name,
    provider.baseUrl,
    provider.apiMode,
    provider.defaultModel,
    ...(provider.models ?? []).flatMap((model) => [model.id, model.name]),
  ].filter(Boolean).join(' ').toLowerCase()
}

function findProviderPreset(provider: ProviderDraft, presets: HermesProviderPreset[]) {
  return presets.find((preset) => (
    preset.key === provider.key
    || (provider.baseUrl && preset.baseUrl === provider.baseUrl)
    || (provider.name && preset.name.toLowerCase() === provider.name.toLowerCase())
  ))
}

function providerCatalogToHermesPresets(providerCatalog: ProviderCatalogEntry[]): HermesProviderPreset[] {
  return providerCatalog
    .filter((provider) => provider.key && provider.baseUrl)
    .map((provider) => {
      const models = (provider.models ?? []).map(catalogModelToHermesModel).filter((model) => model.id)
      return {
        apiKeyUrl: provider.apiKeyUrl,
        apiMode: catalogProviderTypeToHermesApiMode(provider.modelApi),
        baseUrl: provider.baseUrl ?? '',
        defaultModel: models[0]?.id,
        docsUrl: provider.docsUrl,
        icon: provider.icon,
        key: provider.key,
        logoUrl: provider.logoUrl,
        models,
        name: provider.label?.trim() || provider.key,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

function modelInitializationToHermesPreset(value: unknown): HermesProviderPreset | null {
  const payload = objectMap(value)
  const providerKey = normalizeHermesProviderKey(String(payload.providerKey ?? '').trim())
  const baseUrl = String(payload.baseUrl ?? '').trim()
  if (!providerKey || !baseUrl) return null

  const i18n = objectMap(payload.i18n)
  const title = i18n.Title
  const description = i18n.Desc
  const defaultModel = catalogLikeModelToHermesModel(payload.defaultModel)
  const fallbackModels = Array.isArray(payload.fallbackModels)
    ? payload.fallbackModels.map(catalogLikeModelToHermesModel).filter(isHermesModelDefinition)
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

  return {
    apiKey: typeof payload.defaultKey === 'string' ? payload.defaultKey : undefined,
    apiMode: catalogProviderTypeToHermesApiMode(typeof payload.api === 'string' ? payload.api : undefined),
    baseUrl,
    buttons,
    defaultModel: defaultModel?.id,
    description: typeof description === 'string' && description.trim() ? description.trim() : undefined,
    icon: typeof payload.icon === 'string' ? payload.icon : undefined,
    key: providerKey,
    logoUrl: typeof payload.logoUrl === 'string' ? payload.logoUrl : undefined,
    models: mergeModels(defaultModel ? [defaultModel] : [], fallbackModels).filter((model) => model.id),
    name: typeof title === 'string' && title.trim() ? title.trim() : providerKey,
  }
}

function presetToProviderCatalogEntry(preset: HermesProviderPreset): ProviderCatalogEntry {
  return {
    apiKeyUrl: preset.apiKeyUrl,
    baseUrl: preset.baseUrl,
    docsUrl: preset.docsUrl,
    icon: preset.icon,
    key: preset.key,
    label: preset.name,
    logoUrl: preset.logoUrl,
    modelApi: preset.apiMode,
    models: preset.models.map((model) => ({
      contextWindow: model.contextWindow ?? model.contextLength,
      icon: model.raw && typeof model.raw.icon === 'string' ? model.raw.icon : undefined,
      id: model.id,
      name: model.name,
      reasoning: model.reasoning,
      vision: model.input?.includes('image'),
    })),
  }
}

function catalogModelToHermesModel(model: CatalogModelEntry): HermesModelDefinition {
  const contextLength = model.contextWindow
  return {
    contextLength,
    contextWindow: contextLength,
    id: String(model.id ?? '').trim(),
    input: model.vision ? ['text', 'image'] : ['text'],
    name: model.name?.trim() || model.id,
    reasoning: model.reasoning,
  }
}

function catalogLikeModelToHermesModel(value: unknown): HermesModelDefinition | null {
  const model = objectMap(value)
  const id = String(model.id ?? '').trim()
  if (!id) return null
  const contextLength = typeof model.contextWindow === 'number' ? model.contextWindow : undefined

  return {
    contextLength,
    contextWindow: contextLength,
    id,
    input: model.vision ? ['text', 'image'] : ['text'],
    name: typeof model.name === 'string' && model.name.trim() ? model.name.trim() : id,
    reasoning: typeof model.reasoning === 'boolean' ? model.reasoning : undefined,
  }
}

function isHermesModelDefinition(model: HermesModelDefinition | null): model is HermesModelDefinition {
  return Boolean(model?.id)
}

function catalogProviderTypeToHermesApiMode(modelApi?: string): HermesModelApiMode {
  const normalized = String(modelApi ?? '').toLowerCase()
  if (normalized === 'anthropic-messages') return 'anthropic_messages'
  if (normalized === 'openai-responses' || normalized === 'openai-codex-responses') return 'codex_responses'
  if (normalized === 'bedrock-converse-stream' || normalized === 'bedrock-converse') return 'bedrock_converse'
  return 'chat_completions'
}

function objectMap(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...(value as Record<string, unknown>) }
  return {}
}

function providerLogoSrc(providerKey: string, providerCatalog: ProviderCatalog, icon?: string) {
  const catalogProvider = findCatalogProvider(providerKey, providerCatalog)
  if (catalogProvider?.logoUrl) return catalogProvider.logoUrl
  return modelIconUrl(icon ?? catalogProvider?.icon)
}

function modelLogoSrc(model: HermesModelDefinition, providerKey: string, modelCatalog: ModelCatalog, providerCatalog: ProviderCatalog) {
  const catalogModel = findCatalogModel(model, providerKey, modelCatalog)
  const catalogProvider = findCatalogProvider(providerKey, providerCatalog)
  if (catalogProvider?.logoUrl) return catalogProvider.logoUrl
  return modelIconUrl(catalogModel?.icon ?? catalogProvider?.icon)
}

function modelIconUrl(icon?: string) {
  const modelIconBaseUrl = useConfigStore.getState().modelIconBaseUrl
  if (!icon) return `${modelIconBaseUrl}Other.svg`
  if (/^https?:\/\//i.test(icon)) return icon
  return `${modelIconBaseUrl}${encodeURIComponent(icon)}`
}

function findCatalogModel(model: HermesModelDefinition, providerKey: string, modelCatalog: ModelCatalog) {
  const models = modelCatalog[providerKey] ?? modelCatalog[providerKey.toLowerCase()] ?? []
  return models.find((item) => item.id === model.id || item.name === model.name || item.id === model.name || item.name === model.id)
}

function findCatalogProvider(providerKey: string, providerCatalog: ProviderCatalog) {
  return providerCatalog.find((provider) => sameProviderKey(provider.key, providerKey))
}

function providerDisplayName(providerKey: string, providerCatalog: ProviderCatalog, fallbackName?: string) {
  const catalogProvider = findCatalogProvider(providerKey, providerCatalog)
  return fallbackName?.trim() || catalogProvider?.label?.trim() || providerKey
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

function mergeProviderPresets(...groups: HermesProviderPreset[][]) {
  const seen = new Set<string>()
  const presets: HermesProviderPreset[] = []
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

function sameProviderKey(left?: string, right?: string) {
  return normalizeHermesProviderKey(left).toLowerCase() === normalizeHermesProviderKey(right).toLowerCase()
}

function toProviderKey(value: string) {
  return normalizeHermesProviderKey(value.trim().replace(/\s+/g, '-'))
}

function normalizeHermesProviderKey(providerKey?: string) {
  const trimmed = String(providerKey ?? '').trim()
  switch (trimmed.toLowerCase().replace(/_/g, '-')) {
    case 'nex-llm':
      return 'nex-llm'
    default:
      return trimmed
  }
}

function normalizeApiMode(value: unknown): HermesModelApiMode {
  const text = String(value || '').trim()
  return apiModeOptions.includes(text as HermesModelApiMode) ? text as HermesModelApiMode : 'chat_completions'
}

function parseOptionalNumber(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function apiModeIcon(apiMode: HermesModelApiMode) {
  switch (apiMode) {
    case 'anthropic_messages':
      return 'lucide:message-square-text'
    case 'bedrock_converse':
      return 'lucide:layers-3'
    case 'codex_responses':
      return 'lucide:workflow'
    case 'chat_completions':
    default:
      return 'lucide:messages-square'
  }
}

function apiModeDescription(apiMode: HermesModelApiMode) {
  switch (apiMode) {
    case 'anthropic_messages':
      return 'Anthropic Messages'
    case 'bedrock_converse':
      return 'AWS Bedrock Converse'
    case 'codex_responses':
      return 'Codex Responses'
    case 'chat_completions':
    default:
      return 'OpenAI-compatible Chat Completions'
  }
}

function imageInputModeIcon(mode: HermesImageInputMode) {
  switch (mode) {
    case 'native':
      return 'lucide:image'
    case 'text':
      return 'lucide:eye'
    case 'auto':
    default:
      return 'lucide:sparkles'
  }
}

function mergeModels(current: HermesModelDefinition[], incoming: HermesModelDefinition[]) {
  const map = new Map<string, HermesModelDefinition>()
  for (const model of current) {
    if (model.id) map.set(model.id, model)
  }
  for (const model of incoming) {
    if (model.id) map.set(model.id, { ...map.get(model.id), ...model })
  }
  return Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id))
}

function modelsEquivalent(left: HermesModelDefinition[], right: HermesModelDefinition[]) {
  const serialize = (models: HermesModelDefinition[]) => JSON.stringify(
    [...models]
      .map((model) => ({
        contextLength: model.contextLength ?? model.contextWindow ?? 0,
        id: model.id,
        input: model.input ?? [],
        maxTokens: model.maxTokens ?? 0,
        name: model.name ?? '',
        reasoning: Boolean(model.reasoning),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  )
  return serialize(left) === serialize(right)
}

async function openExternalUrl(url?: string) {
  await openUrl(url)
}

function titleizeModel(id: string) {
  return id.replace(/[-_/]+/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase())
}

function formatContext(value?: number) {
  return value ? numberFormatter.format(value) : '-'
}

export default HermesModelsPage

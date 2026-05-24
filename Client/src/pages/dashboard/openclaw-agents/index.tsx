import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Avatar, Button, Card, Checkbox, Chip, Description, Dropdown, Input, Label, ListBox, Modal, SearchField, Separator, Skeleton, Switch, toast, AlertDialog } from '@heroui/react'
import { InlineSelect, ItemCard, ItemCardGroup, PieChart, RadioButtonGroup, Segment } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import type {
  OpenClawAgentBinding,
  OpenClawAgentDetailResponse,
  OpenClawAgentAdvancedSettingsForm,
  OpenClawAgentMutationRequest,
  OpenClawAgentMemoryFile,
  OpenClawAgentMemoryResponse,
  OpenClawAgentMemorySearchResponse,
  OpenClawAgentSummary,
  OpenClawAgentsResponse,
  OpenClawModelDefinition,
  OpenClawModelProvider,
  OpenClawSkillStatus,
  OpenClawSkillsStatusResponse,
} from '@/api'
import { createOpenClawAgent, deleteOpenClawAgent, getOpenClawAgent, getOpenClawAgentFile, getOpenClawAgentMemory, getOpenClawAgentMemoryFile, getOpenClawConfig, getOpenClawSkillsStatus, indexOpenClawAgentMemory, listOpenClawAgents, searchOpenClawAgentMemory, updateOpenClawAgent, updateOpenClawAgentFile, updateOpenClawAgentMemoryFile } from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import EmojiPickerField from '@/components/EmojiPicker'
import DashboardLayout from '@/layouts/Dashboard'

type AgentModelOption = {
  label: string
  modelId: string
  providerKey: string
  value: string
}

function OpenClawAgentsPage() {
  usePageTitle('OpenClaw 智能体')
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [data, setData] = useState<OpenClawAgentsResponse | null>(null)
  const [error, setError] = useState('')
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [detailData, setDetailData] = useState<OpenClawAgentDetailResponse | null>(null)
  const [detailError, setDetailError] = useState('')
  const [modelConfigContent, setModelConfigContent] = useState<Record<string, unknown>>({})
  const [modelConfigError, setModelConfigError] = useState('')
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [activeTab, setActiveTab] = useState<'overview' | 'skills' | 'bindings' | 'files' | 'memory'>('overview')
  const [selectedFileName, setSelectedFileName] = useState('')
  const [fileState, setFileState] = useState<'idle' | 'loading' | 'saving' | 'ready' | 'error'>('idle')
  const [fileContent, setFileContent] = useState('')
  const [savedFileContent, setSavedFileContent] = useState('')
  const [fileError, setFileError] = useState('')
  const [memoryState, setMemoryState] = useState<'idle' | 'loading' | 'saving' | 'ready' | 'error'>('idle')
  const [memoryData, setMemoryData] = useState<OpenClawAgentMemoryResponse | null>(null)
  const [memoryError, setMemoryError] = useState('')
  const [selectedMemoryPath, setSelectedMemoryPath] = useState('')
  const [memoryContent, setMemoryContent] = useState('')
  const [savedMemoryContent, setSavedMemoryContent] = useState('')
  const [memoryFileState, setMemoryFileState] = useState<'idle' | 'loading' | 'saving' | 'ready' | 'error'>('idle')
  const [, setMemoryFileError] = useState('')
  const [memoryQuery, setMemoryQuery] = useState('')
  const [memorySearchState, setMemorySearchState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [memorySearchData, setMemorySearchData] = useState<OpenClawAgentMemorySearchResponse | null>(null)
  const [memorySearchError, setMemorySearchError] = useState('')
  const [memoryIndexState, setMemoryIndexState] = useState<'idle' | 'running'>('idle')
  const [agentFormMode, setAgentFormMode] = useState<'create' | 'edit' | null>(null)
  const [agentFormState, setAgentFormState] = useState<'idle' | 'saving'>('idle')
  const [agentFormError, setAgentFormError] = useState('')
  const [agentForm, setAgentForm] = useState({ id: '', name: '', emoji: '', model: '', workspace: '' })
  const [deleteState, setDeleteState] = useState<'idle' | 'deleting'>('idle')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [skillsState, setSkillsState] = useState<'idle' | 'loading' | 'ready' | 'saving' | 'error'>('idle')
  const [skillsData, setSkillsData] = useState<OpenClawSkillsStatusResponse | null>(null)
  const [skillsError, setSkillsError] = useState('')
  const [selectedSkillKeys, setSelectedSkillKeys] = useState<string[]>([])
  const [savedSkillKeys, setSavedSkillKeys] = useState<string[]>([])
  const [advancedState, setAdvancedState] = useState<'idle' | 'saving'>('idle')
  const [advancedError, setAdvancedError] = useState('')
  const [advancedForm, setAdvancedForm] = useState<OpenClawAgentAdvancedSettingsForm>(emptyAdvancedSettingsForm)
  const [savedAdvancedForm, setSavedAdvancedForm] = useState<OpenClawAgentAdvancedSettingsForm>(emptyAdvancedSettingsForm)
  const [advancedSection, setAdvancedSection] = useState<'reasoning' | 'tools' | 'routing'>('reasoning')
  const defaultSkillKeys = useMemo(() => data?.defaults.skills ?? [], [data?.defaults.skills])

  const loadAgents = useCallback(async () => {
    setState('loading')
    setError('')
    setModelConfigError('')

    try {
      const [payload, configPayload] = await Promise.all([
        listOpenClawAgents(),
        getOpenClawConfig().catch((err: unknown) => {
          setModelConfigError(err instanceof Error ? err.message : '模型配置加载失败')
          return null
        }),
      ])
      setData(payload)
      setModelConfigContent(configPayload?.content ?? {})
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : '智能体列表加载失败')
      setState('error')
    }
  }, [])

  const loadDetail = useCallback(async (agentId: string) => {
    if (!agentId) return
    setDetailState('loading')
    setDetailError('')

    try {
      const payload = await getOpenClawAgent(agentId)
      setDetailData(payload)
      setDetailState('ready')
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : '智能体详情加载失败')
      setDetailState('error')
    }
  }, [])

  const loadAgentFile = useCallback(async (agentId: string, fileName: string) => {
    if (!agentId || !fileName) return
    setFileState('loading')
    setFileError('')

    try {
      const payload = await getOpenClawAgentFile(agentId, fileName)
      setFileContent(payload.content)
      setSavedFileContent(payload.content)
      setFileState('ready')
    } catch (err) {
      setFileContent('')
      setSavedFileContent('')
      setFileError(err instanceof Error ? err.message : '智能体文件读取失败')
      setFileState('error')
    }
  }, [])

  const loadAgentMemory = useCallback(async (agentId: string) => {
    if (!agentId) return
    setMemoryState('loading')
    setMemoryError('')

    try {
      const payload = await getOpenClawAgentMemory(agentId)
      setMemoryData(payload)
      setMemoryState('ready')
      return payload
    } catch (err) {
      setMemoryData(null)
      setMemoryError(err instanceof Error ? err.message : '智能体记忆加载失败')
      setMemoryState('error')
      return null
    }
  }, [])

  const loadAgentMemoryFile = useCallback(async (agentId: string, path: string) => {
    if (!agentId || !path) return
    setMemoryFileState('loading')
    setMemoryFileError('')

    try {
      const payload = await getOpenClawAgentMemoryFile(agentId, path)
      setMemoryContent(payload.content)
      setSavedMemoryContent(payload.content)
      setMemoryFileState('ready')
    } catch (err) {
      setMemoryContent('')
      setSavedMemoryContent('')
      setMemoryFileError(err instanceof Error ? err.message : '记忆文件读取失败')
      setMemoryFileState('error')
    }
  }, [])

  const loadAgentSkills = useCallback(async (agentId: string) => {
    if (!agentId) return
    setSkillsState('loading')
    setSkillsError('')

    try {
      const payload = await getOpenClawSkillsStatus(agentId)
      setSkillsData(payload)
      setSkillsState('ready')
      return payload
    } catch (err) {
      setSkillsData(null)
      setSkillsError(err instanceof Error ? err.message : '智能体技能列表加载失败')
      setSkillsState('error')
      return null
    }
  }, [])

  const saveAgentFile = useCallback(async () => {
    if (!selectedAgentId || !selectedFileName) return
    setFileState('saving')
    setFileError('')

    try {
      const payload = await updateOpenClawAgentFile(selectedAgentId, selectedFileName, { content: fileContent })
      setFileContent(payload.content)
      setSavedFileContent(payload.content)
      setFileState('ready')
      toast.success('文件已保存')
      await loadDetail(selectedAgentId)
    } catch (err) {
      setFileError(err instanceof Error ? err.message : '智能体文件保存失败')
      setFileState('error')
      toast.warning('文件保存失败')
    }
  }, [fileContent, loadDetail, selectedAgentId, selectedFileName])

  const saveAgentMemoryFile = useCallback(async () => {
    if (!selectedAgentId || !selectedMemoryPath) return
    setMemoryFileState('saving')
    setMemoryFileError('')

    try {
      const payload = await updateOpenClawAgentMemoryFile(selectedAgentId, selectedMemoryPath, { content: memoryContent })
      setMemoryContent(payload.content)
      setSavedMemoryContent(payload.content)
      setMemoryFileState('ready')
      toast.success('记忆文件已保存')
      await loadAgentMemory(selectedAgentId)
    } catch (err) {
      setMemoryFileError(err instanceof Error ? err.message : '记忆文件保存失败')
      setMemoryFileState('error')
      toast.warning('记忆文件保存失败')
    }
  }, [loadAgentMemory, memoryContent, selectedAgentId, selectedMemoryPath])

  const runAgentMemorySearch = useCallback(async () => {
    if (!selectedAgentId) return
    const query = memoryQuery.trim()
    if (!query) {
      setMemorySearchError('请输入搜索关键词。')
      return
    }
    setMemorySearchState('loading')
    setMemorySearchError('')

    try {
      const payload = await searchOpenClawAgentMemory(selectedAgentId, { query, maxResults: 12 })
      setMemorySearchData(payload)
      setMemorySearchState('ready')
    } catch (err) {
      setMemorySearchData(null)
      setMemorySearchError(err instanceof Error ? err.message : '记忆搜索失败')
      setMemorySearchState('error')
    }
  }, [memoryQuery, selectedAgentId])

  const runAgentMemoryIndex = useCallback(async () => {
    if (!selectedAgentId) return
    setMemoryIndexState('running')
    setMemoryError('')
    try {
      await indexOpenClawAgentMemory(selectedAgentId, { force: true })
      toast.success('记忆索引已更新')
      await loadAgentMemory(selectedAgentId)
    } catch (err) {
      const message = err instanceof Error ? err.message : '记忆索引更新失败'
      setMemoryError(message)
      toast.warning(message)
    } finally {
      setMemoryIndexState('idle')
    }
  }, [loadAgentMemory, selectedAgentId])

  const copyAgentFileContent = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(fileContent)
      toast.success('文件内容已复制')
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '复制失败')
    }
  }, [fileContent])

  const downloadAgentFileContent = useCallback(() => {
    const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = selectedFileName || 'agent-file.txt'
    anchor.click()
    URL.revokeObjectURL(url)
  }, [fileContent, selectedFileName])

  const copyAgentMemoryContent = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(memoryContent)
      toast.success('记忆内容已复制')
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '复制失败')
    }
  }, [memoryContent])

  const downloadAgentMemoryContent = useCallback(() => {
    const blob = new Blob([memoryContent], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = selectedMemoryPath.split('/').pop() || 'memory.md'
    anchor.click()
    URL.revokeObjectURL(url)
  }, [memoryContent, selectedMemoryPath])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadAgents()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [loadAgents])

  const agents = useMemo(() => data?.agents ?? [], [data?.agents])
  const bindings = useMemo(() => data?.bindings ?? [], [data?.bindings])
  const selectedFiles = useMemo(() => detailData?.files ?? [], [detailData?.files])
  const memoryFiles = useMemo(() => memoryData?.files ?? [], [memoryData?.files])

  useEffect(() => {
    if (!agents.length) return
    if (!selectedAgentId || !agents.some((agent) => agent.id === selectedAgentId)) {
      const frame = window.requestAnimationFrame(() => {
        setSelectedAgentId(agents[0].id)
      })

      return () => window.cancelAnimationFrame(frame)
    }
  }, [agents, selectedAgentId])

  useEffect(() => {
    if (selectedAgentId) {
      const timeoutId = window.setTimeout(() => {
        void loadDetail(selectedAgentId)
      }, 0)

      return () => window.clearTimeout(timeoutId)
    }
  }, [loadDetail, selectedAgentId])

  useEffect(() => {
    if (!selectedFiles.length) {
      const frame = window.requestAnimationFrame(() => {
        setSelectedFileName('')
      })

      return () => window.cancelAnimationFrame(frame)
    }
    if (!selectedFileName || !selectedFiles.some((file) => file.name === selectedFileName)) {
      const frame = window.requestAnimationFrame(() => {
        setSelectedFileName(selectedFiles[0].name)
      })

      return () => window.cancelAnimationFrame(frame)
    }
  }, [selectedFileName, selectedFiles])

  useEffect(() => {
    if (activeTab === 'files' && selectedAgentId && selectedFileName) {
      const timeoutId = window.setTimeout(() => {
        void loadAgentFile(selectedAgentId, selectedFileName)
      }, 0)

      return () => window.clearTimeout(timeoutId)
    }
  }, [activeTab, loadAgentFile, selectedAgentId, selectedFileName])

  useEffect(() => {
    if (activeTab === 'memory' && selectedAgentId) {
      const timeoutId = window.setTimeout(() => {
        void loadAgentMemory(selectedAgentId)
      }, 0)

      return () => window.clearTimeout(timeoutId)
    }
  }, [activeTab, loadAgentMemory, selectedAgentId])

  useEffect(() => {
    if (activeTab !== 'memory') return
    if (!memoryFiles.length) {
      const frame = window.requestAnimationFrame(() => {
        setSelectedMemoryPath('')
      })

      return () => window.cancelAnimationFrame(frame)
    }
    if (!selectedMemoryPath || !memoryFiles.some((file) => file.relativePath === selectedMemoryPath)) {
      const firstExisting = memoryFiles.find((file) => file.exists) ?? memoryFiles[0]
      const frame = window.requestAnimationFrame(() => {
        setSelectedMemoryPath(firstExisting.relativePath)
      })

      return () => window.cancelAnimationFrame(frame)
    }
  }, [activeTab, memoryFiles, selectedMemoryPath])

  useEffect(() => {
    if (activeTab === 'memory' && selectedAgentId && selectedMemoryPath) {
      const timeoutId = window.setTimeout(() => {
        void loadAgentMemoryFile(selectedAgentId, selectedMemoryPath)
      }, 0)

      return () => window.clearTimeout(timeoutId)
    }
  }, [activeTab, loadAgentMemoryFile, selectedAgentId, selectedMemoryPath])

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? detailData?.agent ?? null,
    [agents, detailData?.agent, selectedAgentId],
  )
  const orderedAgents = useMemo(() => {
    const defaultAgents = agents.filter((agent) => agent.isDefault)
    const otherAgents = agents.filter((agent) => !agent.isDefault)
    return [...defaultAgents, ...otherAgents]
  }, [agents])
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (selectedAgent) {
        const nextAdvancedForm = resolveAgentAdvancedSettingsForm(selectedAgent)
        setAdvancedForm(nextAdvancedForm)
        setSavedAdvancedForm(nextAdvancedForm)
        setAdvancedError('')
      } else {
        setAdvancedForm(emptyAdvancedSettingsForm)
        setSavedAdvancedForm(emptyAdvancedSettingsForm)
        setAdvancedError('')
      }
    })

    return () => window.cancelAnimationFrame(frame)
  }, [selectedAgent])

  const selectedBindings = useMemo<OpenClawAgentBinding[]>(() => selectedAgent?.bindings ?? [], [selectedAgent?.bindings])
  const selectedFile = selectedFiles.find((file) => file.name === selectedFileName) ?? selectedFiles[0] ?? null
  const selectedFileLabel = selectedFile?.name ? agentWorkspaceFileLabel(selectedFile.name) : ''
  const hasFileChanges = fileContent !== savedFileContent
  const selectedMemoryFile = memoryFiles.find((file) => file.relativePath === selectedMemoryPath) ?? memoryFiles[0] ?? null
  const hasMemoryChanges = memoryContent !== savedMemoryContent
  const agentModelOptions = useMemo(() => buildAgentModelOptions(modelConfigContent), [modelConfigContent])
  const readyStats = useMemo(() => buildAgentReadyStats(agents), [agents])
  const readyChartData = useMemo(
    () => [
      { name: '完全就绪', value: readyStats.ready, fill: 'var(--success)' },
      { name: '部分就绪', value: readyStats.partial, fill: 'var(--warning)' },
      { name: '未就绪', value: readyStats.notReady, fill: 'var(--danger)' },
    ].filter((item) => item.value > 0),
    [readyStats],
  )
  const selectedBindingsCount = selectedAgent?.bindingsCount ?? selectedBindings.length
  const selectedRuntimeLabel = selectedAgent ? runtimeLabel(selectedAgent) : '-'
  const rawConfigText = useMemo(() => JSON.stringify(selectedAgent?.config ?? {}, null, 2), [selectedAgent?.config])
  const skillCards = useMemo(
    () => (skillsData?.skills ?? []).slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    [skillsData?.skills],
  )
  const selectedSkillKeySet = useMemo(() => new Set(selectedSkillKeys), [selectedSkillKeys])
  const skillsMode = selectedAgent ? getAgentSkillsMode(selectedAgent, defaultSkillKeys) : 'unrestricted'
  const hasSkillChanges = !sameStringSet(selectedSkillKeys, savedSkillKeys)
  const hasAdvancedChanges = !sameAdvancedSettingsForm(advancedForm, savedAdvancedForm)
  const isLoading = state === 'loading' && !data

  const openCreateAgentForm = useCallback(() => {
    const defaultModel = data?.defaults.model ?? ''
    const nextModel = agentModelOptions.some((option) => option.value === defaultModel) ? defaultModel : agentModelOptions[0]?.value ?? ''
    setAgentFormMode('create')
    setAgentFormError('')
    setAgentForm({ id: '', name: '', emoji: '', model: nextModel, workspace: '' })
  }, [agentModelOptions, data?.defaults.model])

  const openEditAgentForm = useCallback(() => {
    if (!selectedAgent) return
    const currentModel = selectedAgent.model || data?.defaults.model || ''
    const nextModel = agentModelOptions.some((option) => option.value === currentModel) ? currentModel : ''
    setAgentFormMode('edit')
    setAgentFormError('')
    setAgentForm({
      id: selectedAgent.id,
      name: selectedAgent.name || selectedAgent.identity.name || '',
      emoji: selectedAgent.identity.emoji || '',
      model: nextModel,
      workspace: selectedAgent.workspace || '',
    })
  }, [agentModelOptions, data?.defaults.model, selectedAgent])

  const saveAgentForm = useCallback(async () => {
    const request: OpenClawAgentMutationRequest = {
      id: agentForm.id.trim(),
      name: agentForm.name.trim(),
      emoji: agentForm.emoji.trim(),
      model: agentForm.model.trim(),
      workspace: agentForm.workspace.trim(),
    }
    if (agentFormMode === 'create' && !request.id) {
      setAgentFormError('新建智能体需要填写 ID。')
      return false
    }
    if (!agentModelOptions.length) {
      setAgentFormError('请先前往模型配置添加模型，再选择智能体使用的模型。')
      return false
    }
    if (!request.model || !agentModelOptions.some((option) => option.value === request.model)) {
      setAgentFormError('请从已添加模型中选择一个模型。')
      return false
    }
    if (!agentFormMode) return false
    setAgentFormState('saving')
    setAgentFormError('')
    try {
      const payload = agentFormMode === 'create'
        ? await createOpenClawAgent(request)
        : await updateOpenClawAgent(agentForm.id, request)
      toast.success(agentFormMode === 'create' ? '智能体已创建' : '智能体已更新')
      setSelectedAgentId(payload.agent.id)
      setDetailData(payload)
      await loadAgents()
      return true
    } catch (err) {
      setAgentFormError(err instanceof Error ? err.message : '智能体保存失败')
      toast.warning('智能体保存失败')
      return false
    } finally {
      setAgentFormState('idle')
    }
  }, [agentForm, agentFormMode, agentModelOptions, loadAgents])

  const uninstallAgent = useCallback(async () => {
    if (!selectedAgent || selectedAgent.isDefault) return
    setDeleteState('deleting')
    try {
      const payload = await deleteOpenClawAgent(selectedAgent.id)
      toast.success(payload.workspaceRetained ? '智能体已卸载，Workspace 已保留' : '智能体已卸载')
      setDeleteDialogOpen(false)
      setDetailData(null)
      setSelectedFileName('')
      setFileContent('')
      setSavedFileContent('')
      setMemoryData(null)
      setSelectedMemoryPath('')
      setMemoryContent('')
      setSavedMemoryContent('')
      setMemorySearchData(null)
      await loadAgents()
      const nextAgent = agents.find((agent) => agent.id !== selectedAgent.id)
      setSelectedAgentId(nextAgent?.id ?? '')
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '智能体卸载失败')
    } finally {
      setDeleteState('idle')
    }
  }, [agents, loadAgents, selectedAgent])

  const toggleAgentSkill = useCallback((skill: OpenClawSkillStatus, isSelected: boolean) => {
    const key = skill.skillKey || skill.name
    setSelectedSkillKeys((current) => {
      if (isSelected) return current.includes(key) ? current : [...current, key]
      return current.filter((item) => item !== key)
    })
  }, [])

  const saveAgentSkills = useCallback(async () => {
    if (!selectedAgent) return
    setSkillsState('saving')
    setSkillsError('')
    try {
      const nextSkills = selectedSkillKeys.slice().sort((a, b) => a.localeCompare(b, 'zh-CN'))
      const payload = await updateOpenClawAgent(selectedAgent.id, {
        id: selectedAgent.id,
        skills: nextSkills,
        skillsMode: 'explicit',
      })
      setDetailData(payload)
      setSavedSkillKeys(nextSkills)
      await loadAgents()
      await loadAgentSkills(selectedAgent.id)
      setSkillsState('ready')
      toast.success('技能白名单已保存')
    } catch (err) {
      setSkillsError(err instanceof Error ? err.message : '技能白名单保存失败')
      setSkillsState('error')
      toast.warning('技能白名单保存失败')
    }
  }, [loadAgentSkills, loadAgents, selectedAgent, selectedSkillKeys])

  const resetAgentSkillsToInherited = useCallback(async () => {
    if (!selectedAgent) return
    setSkillsState('saving')
    setSkillsError('')
    try {
      const payload = await updateOpenClawAgent(selectedAgent.id, {
        id: selectedAgent.id,
        skillsMode: defaultSkillKeys.length ? 'inherit' : 'unrestricted',
      })
      const nextSkills: string[] = []
      setDetailData(payload)
      setSelectedSkillKeys(nextSkills)
      setSavedSkillKeys(nextSkills)
      await loadAgents()
      await loadAgentSkills(selectedAgent.id)
      setSkillsState('ready')
      toast.success(defaultSkillKeys.length ? '已恢复继承默认技能白名单' : '已恢复为不限制技能')
    } catch (err) {
      setSkillsError(err instanceof Error ? err.message : '恢复技能继承失败')
      setSkillsState('error')
      toast.warning('恢复技能继承失败')
    }
  }, [defaultSkillKeys, loadAgentSkills, loadAgents, selectedAgent])

  const updateAdvancedForm = useCallback(<K extends keyof OpenClawAgentAdvancedSettingsForm>(key: K, value: OpenClawAgentAdvancedSettingsForm[K]) => {
    setAdvancedForm((current) => ({ ...current, [key]: value }))
  }, [])

  const saveAdvancedSettings = useCallback(async () => {
    if (!selectedAgent) return
    setAdvancedState('saving')
    setAdvancedError('')
    try {
      const request = buildAgentAdvancedSettingsRequest(selectedAgent.id, advancedForm)
      const payload = await updateOpenClawAgent(selectedAgent.id, request)
      const nextAdvancedForm = resolveAgentAdvancedSettingsForm(payload.agent)
      setDetailData(payload)
      setAdvancedForm(nextAdvancedForm)
      setSavedAdvancedForm(nextAdvancedForm)
      await loadAgents()
      toast.success('高级设置已保存')
    } catch (err) {
      setAdvancedError(err instanceof Error ? err.message : '高级设置保存失败')
      toast.warning('高级设置保存失败')
    } finally {
      setAdvancedState('idle')
    }
  }, [advancedForm, loadAgents, selectedAgent])

  if (error && !data) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[calc(100dvh-8rem)] items-center justify-center">
          <Card className="w-full max-w-md">
            <Card.Content>
              <div className="flex flex-col items-center px-6 py-8 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-warning/10 text-warning">
                  <Icon icon="lucide:triangle-alert" className="size-6" />
                </div>
                <h2 className="mt-4 text-lg font-semibold text-foreground">无法加载智能体列表</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted">{error}</p>
                <Button className="mt-6" variant="primary" onPress={() => void loadAgents()} isDisabled={state === 'loading'}>
                  <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'animate-spin' : ''} />
                  重新加载
                </Button>
              </div>
            </Card.Content>
          </Card>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
          <Card variant="transparent" className="h-full overflow-visible">
            <Card.Content className="flex h-full items-center overflow-visible justify-start">
              <div className="md:gap-6 gap-4 flex w-full flex-row items-center overflow-visible">
                <div className="flex h-36 items-center justify-center shrink-0 overflow-visible p-1">
                  <img src="https://assets.orence.net/file/20260512222710045.png" alt="System Overview" className="h-full w-auto" />
                </div>
                <div className="flex min-w-0 flex-col gap-5 w-full">
                  <div className="min-w-0">
                    <Card.Title className="md:text-3xl text-2xl font-bold">Agent</Card.Title>
                    <Card.Description className="mt-4 md:text-lg text-base">查看 OpenClaw Agent 信息，包括基本信息、配置文件、备份恢复等。</Card.Description>
                    <AgentConfigModal
                      isOpen={agentFormMode === 'create'}
                      mode="create"
                      value={agentForm}
                      error={agentFormMode === 'create' ? agentFormError : ''}
                      isSaving={agentFormState === 'saving'}
                      modelOptions={agentModelOptions}
                      modelConfigError={modelConfigError}
                      onChange={setAgentForm}
                      onCancel={() => setAgentFormMode(null)}
                      onSave={saveAgentForm}
                    >
                      <Button className="mt-4" size="sm" variant="primary" onPress={openCreateAgentForm}>
                        <Icon icon="lucide:bot" className="size-4" />
                        新建Agent
                      </Button>
                    </AgentConfigModal>
                  </div>
                </div>
              </div>
            </Card.Content>
          </Card>

          <AgentReadyPieChart stats={readyStats} chartData={readyChartData} />
        </section>

        {isLoading ? <PageSkeleton /> : null}
        {data ? (
          <section className="flex flex-col gap-6">
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
                  {selectedAgent ? (
                    <Dropdown>
                      <Button variant="tertiary" className="rounded-full pl-0">

                        <span className="min-w-0 truncate text-sm font-semibold text-foreground pl-4">{selectedAgent.identity.emoji || initialsForAgent(selectedAgent)}</span>
                        <span className="min-w-0 truncate text-sm font-semibold text-foreground">{selectedAgent.name || selectedAgent.id}</span>
                        <Icon icon="lucide:chevron-down" className="size-4 text-muted" />
                      </Button>
                      <Dropdown.Popover className="min-w-[auto]" placement="bottom start">
                        <Dropdown.Menu selectedKeys={new Set(selectedAgentId ? [selectedAgentId] : [])} selectionMode="single" onAction={(key) => setSelectedAgentId(String(key))}>
                          {orderedAgents.map((agent) => (
                            <Dropdown.Item key={agent.id} id={agent.id} textValue={agent.name || agent.id}>
                              <Dropdown.ItemIndicator type="dot" />
                              <div className="flex min-w-0 items-center gap-3">
                                <Avatar size="sm" color={agent.isDefault ? 'accent' : agent.sessionStoreExists ? 'success' : 'danger'} variant="soft">
                                  <Avatar.Fallback>{agent.identity.emoji || initialsForAgent(agent)}</Avatar.Fallback>
                                </Avatar>
                                <div className="min-w-0 flex-1">
                                  <Label className="truncate">{agent.name || agent.id} 丨 ID-{agent.id}</Label>
                                </div>
                              </div>
                            </Dropdown.Item>
                          ))}
                        </Dropdown.Menu>
                      </Dropdown.Popover>
                    </Dropdown>
                  ) : null}

                  <Segment selectedKey={activeTab} onSelectionChange={(key) => {
                    const nextTab = key as typeof activeTab
                    setActiveTab(nextTab)
                    if (nextTab === 'skills' && selectedAgentId) {
                      void loadAgentSkills(selectedAgentId).then(() => {
                        if (!selectedAgent) return
                        const initialSkills = resolveAgentSkillSelection(selectedAgent, defaultSkillKeys)
                        setSelectedSkillKeys(initialSkills)
                        setSavedSkillKeys(initialSkills)
                      })
                    }
                    if (nextTab === 'memory' && selectedAgentId) {
                      void loadAgentMemory(selectedAgentId)
                    }
                  }}>
                    <Segment.Item id="overview">
                      <Segment.Separator />
                      概览
                    </Segment.Item>
                    <Segment.Item id="skills">
                      <Segment.Separator />
                      技能
                    </Segment.Item>
                    <Segment.Item id="files">
                      <Segment.Separator />
                      文件
                    </Segment.Item>
                    <Segment.Item id="memory">
                      <Segment.Separator />
                      记忆
                    </Segment.Item>
                    <Segment.Item id="bindings">
                      <Segment.Separator />
                      绑定
                    </Segment.Item>
                  </Segment>
                </div>

                <div className="flex items-center gap-2">
                  {activeTab === 'files' && selectedFiles.length ? (
                    <Dropdown>
                      <Button size="sm" variant="tertiary">
                        <Icon icon="lucide:file-text" className="size-4" />
                        {selectedFileLabel || '选择文件'}
                        <Icon icon="lucide:chevron-down" className="size-4 text-muted" />
                      </Button>
                      <Dropdown.Popover className="min-w-[auto]" placement="bottom end">
                        <Dropdown.Menu selectedKeys={new Set(selectedFileName ? [selectedFileName] : [])} selectionMode="single" onAction={(key) => setSelectedFileName(String(key))}>
                          {selectedFiles.map((file) => (
                            <Dropdown.Item key={file.name} id={file.name} textValue={agentWorkspaceFileLabel(file.name)}>
                              <Dropdown.ItemIndicator />
                              <div className="min-w-0">
                                <Label className="truncate">{agentWorkspaceFileLabel(file.name)}</Label>
                                <p className="mt-1 truncate text-xs text-muted">{file.name}</p>
                              </div>
                            </Dropdown.Item>
                          ))}
                        </Dropdown.Menu>
                      </Dropdown.Popover>
                    </Dropdown>
                  ) : null}
                  {activeTab === 'files' && selectedFiles.length && hasFileChanges ? (
                    <Button size="sm" variant="primary" onPress={() => void saveAgentFile()} isDisabled={!selectedFileName || fileState === 'loading' || fileState === 'saving'}>
                      <Icon icon={fileState === 'saving' ? 'lucide:loader-circle' : 'lucide:save'} className={fileState === 'saving' ? 'animate-spin' : ''} />
                      更新
                    </Button>
                  ) : null}
                  {activeTab === 'memory' && selectedMemoryFile && hasMemoryChanges ? (
                    <Button size="sm" variant="primary" onPress={() => void saveAgentMemoryFile()} isDisabled={!selectedMemoryPath || memoryFileState === 'loading' || memoryFileState === 'saving'}>
                      <Icon icon={memoryFileState === 'saving' ? 'lucide:loader-circle' : 'lucide:save'} className={memoryFileState === 'saving' ? 'animate-spin' : ''} />
                      保存记忆
                    </Button>
                  ) : null}
                  {activeTab === 'skills' && selectedAgent ? (
                    <>
                      <Button
                        size="sm"
                        variant="tertiary"
                        onPress={() => void resetAgentSkillsToInherited()}
                        isDisabled={skillsState === 'loading' || skillsState === 'saving' || skillsMode !== 'explicit'}
                      >
                        <Icon icon="lucide:rotate-ccw" className="size-4" />
                        恢复继承
                      </Button>
                      {hasSkillChanges ? (
                        <Button size="sm" variant="primary" onPress={() => void saveAgentSkills()} isDisabled={skillsState === 'loading' || skillsState === 'saving'}>
                          <Icon icon={skillsState === 'saving' ? 'lucide:loader-circle' : 'lucide:save'} className={skillsState === 'saving' ? 'animate-spin' : ''} />
                          保存技能
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                  {activeTab !== 'files' && activeTab !== 'skills' && activeTab !== 'memory' && selectedAgent ? (
                    <AgentConfigModal
                      isOpen={agentFormMode === 'edit'}
                      mode="edit"
                      value={agentForm}
                      error={agentFormMode === 'edit' ? agentFormError : ''}
                      isSaving={agentFormState === 'saving'}
                      modelOptions={agentModelOptions}
                      modelConfigError={modelConfigError}
                      onChange={setAgentForm}
                      onCancel={() => setAgentFormMode(null)}
                      onSave={saveAgentForm}
                    >
                      <Button size="sm" variant="tertiary" onPress={openEditAgentForm}>
                        <Icon icon="lucide:pencil" className="size-4" />
                        编辑
                      </Button>
                    </AgentConfigModal>
                  ) : null}
                  {activeTab === 'overview' && selectedAgent && !selectedAgent.isDefault ? (
                    <Button
                      size="sm"
                      variant="danger"
                      onPress={() => setDeleteDialogOpen(true)}
                      isDisabled={deleteState === 'deleting'}
                    >
                      <Icon icon={deleteState === 'deleting' ? 'lucide:loader-circle' : 'lucide:trash-2'} className={deleteState === 'deleting' ? 'animate-spin' : ''} />
                      卸载
                    </Button>
                  ) : null}

                  <Button
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    onPress={() => {
                      if (activeTab === 'files' && selectedAgentId && selectedFileName) {
                        void loadAgentFile(selectedAgentId, selectedFileName)
                        return
                      }
                      if (activeTab === 'skills' && selectedAgentId) {
                        void loadAgentSkills(selectedAgentId)
                        return
                      }
                      if (activeTab === 'memory' && selectedAgentId) {
                        void loadAgentMemory(selectedAgentId)
                        if (selectedMemoryPath) {
                          void loadAgentMemoryFile(selectedAgentId, selectedMemoryPath)
                        }
                        return
                      }
                      if (selectedAgent) {
                        const nextAdvancedForm = resolveAgentAdvancedSettingsForm(selectedAgent)
                        setAdvancedForm(nextAdvancedForm)
                        setSavedAdvancedForm(nextAdvancedForm)
                        setAdvancedError('')
                      }
                      void loadAgents()
                    }}
                    isDisabled={state === 'loading' || fileState === 'loading' || fileState === 'saving' || skillsState === 'loading' || skillsState === 'saving' || memoryState === 'loading' || memoryFileState === 'loading' || memoryFileState === 'saving' || memoryIndexState === 'running'}
                  >
                    <Icon
                      icon={(activeTab === 'files' ? fileState === 'loading' || fileState === 'saving' : activeTab === 'skills' ? skillsState === 'loading' || skillsState === 'saving' : activeTab === 'memory' ? memoryState === 'loading' || memoryFileState === 'loading' || memoryFileState === 'saving' || memoryIndexState === 'running' : state === 'loading') ? 'lucide:loader-circle' : 'lucide:refresh-cw'}
                      className={(activeTab === 'files' ? fileState === 'loading' || fileState === 'saving' : activeTab === 'skills' ? skillsState === 'loading' || skillsState === 'saving' : activeTab === 'memory' ? memoryState === 'loading' || memoryFileState === 'loading' || memoryFileState === 'saving' || memoryIndexState === 'running' : state === 'loading') ? 'animate-spin' : ''}
                    />
                  </Button>
                </div>
              </div>

              <Card className="relative overflow-visible">
                <Card.Content>
                  {detailError && !detailData ? (
                    <InlineError title="智能体详情加载失败" message={detailError} onRetry={() => void loadDetail(selectedAgentId)} />
                  ) : null}

                  <div>
                    {activeTab === 'overview' ? (
                      <div className="space-y-4">
                        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(440px,1.1fr)]">
                          <div className="space-y-4">
                            <section className="grid gap-4 sm:grid-cols-2">
                              <InfoCard label="ID" value={selectedAgent?.id || '-'} />
                              <InfoCard label="名称" value={selectedAgent?.name || '-'} />
                              <InfoCard label="模型" value={selectedAgent?.model || data.defaults.model || '-'} />
                              <InfoCard label="默认Agent" value={selectedAgent?.isDefault ? '是' : '否'} />
                              <InfoCard label="Runtime" value={selectedRuntimeLabel} />
                              {/* <InfoCard label="Identity" value={selectedIdentityLabel} /> */}
                              <InfoCard label="Workspace" value={selectedAgent?.workspace || '-'} />
                              <InfoCard label="Session Store" value={selectedAgent?.sessionStore || '-'} />
                              <InfoCard label="Agent Dir" value={selectedAgent?.agentDir || '-'} />
                              {/* <InfoCard label="Bindings" value={String(selectedBindingsCount)} /> */}
                            </section>

                            <section className="grid gap-4 grid-cols-3 xl:grid-cols-3 2xl:grid-cols-3">
                              <StatusTile label="Workspace" ok={Boolean(selectedAgent?.workspaceExists)} text={selectedAgent?.workspaceExists ? '目录存在' : '目录缺失'} />
                              <StatusTile label="Agent Dir" ok={Boolean(selectedAgent?.agentDirExists)} text={selectedAgent?.agentDirExists ? '目录存在' : '目录缺失'} />
                              <StatusTile label="Session Store" ok={Boolean(selectedAgent?.sessionStoreExists)} text={selectedAgent?.sessionStoreExists ? '文件存在' : '文件缺失'} />
                            </section>

                            {skillsMode !== 'unrestricted' ? (
                              <div className="rounded-2xl bg-surface-secondary/50 px-4 py-4 text-sm leading-6 text-muted">
                                {skillsMode === 'explicit'
                                  ? selectedAgent?.skills?.length
                                    ? `Skills: ${selectedAgent.skills.join(' · ')}`
                                    : '当前智能体显式配置为空技能白名单。'
                                  : `当前技能允许列表继承自 defaults：${data.defaults.skills?.join(' · ')}`}
                              </div>
                            ) : null}
                          </div>

                          <AdvancedSettingsCards
                            value={advancedForm}
                            bindingsCount={selectedBindingsCount}
                            activeSection={advancedSection}
                            hasChanges={hasAdvancedChanges}
                            isSaving={advancedState === 'saving'}
                            error={advancedError}
                            onSectionChange={setAdvancedSection}
                            onChange={updateAdvancedForm}
                            onSave={saveAdvancedSettings}
                          />
                        </div>
                      </div>
                    ) : null}

                    {activeTab === 'skills' ? (
                      <div className="space-y-4">
                        <Card className="bg-surface-secondary/50">
                          <Card.Content>
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-semibold text-foreground">技能白名单</p>
                                  <Chip size="sm" variant="soft" color={skillsMode === 'explicit' ? 'accent' : 'success'}>
                                    {agentSkillsStatusLabel(skillsMode)}
                                  </Chip>
                                  <Chip size="sm" variant="soft">已选 {selectedSkillKeys.length}</Chip>
                                </div>
                                <p className="mt-2 text-sm leading-6 text-muted">
                                  勾选后保存作为该智能体的最终技能集合，保存空列表表示该智能体不可见任何技能。
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button size="sm" variant="tertiary" onPress={() => setSelectedSkillKeys(skillCards.map((skill) => skill.skillKey || skill.name))} isDisabled={skillsState === 'loading' || skillsState === 'saving' || !skillCards.length}>
                                  全选
                                </Button>
                                <Button size="sm" variant="tertiary" onPress={() => setSelectedSkillKeys([])} isDisabled={skillsState === 'loading' || skillsState === 'saving'}>
                                  清空
                                </Button>
                              </div>
                            </div>
                          </Card.Content>
                        </Card>

                        {skillsError ? <div className="rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">{skillsError}</div> : null}

                        {skillsState === 'loading' && !skillsData ? (
                          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            <Skeleton className="h-36 rounded-2xl" />
                            <Skeleton className="h-36 rounded-2xl" />
                            <Skeleton className="h-36 rounded-2xl" />
                          </div>
                        ) : null}

                        {skillCards.length ? (
                          <div className="relative h-[calc(100dvh-290px)] min-h-0 overflow-hidden">
                            <div className="absolute inset-0 overflow-y-auto overflow-x-hidden">
                              <div className="grid auto-rows-min items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                                {skillCards.map((skill) => {
                                  const key = skill.skillKey || skill.name
                                  return (
                                    <AgentSkillCard
                                      key={key}
                                      skill={skill}
                                      isSelected={selectedSkillKeySet.has(key)}
                                      isDisabled={skillsState === 'loading' || skillsState === 'saving'}
                                      onChange={(isSelected) => toggleAgentSkill(skill, isSelected)}
                                    />
                                  )
                                })}
                              </div>
                            </div>
                          </div>
                        ) : skillsState !== 'loading' ? (
                          <EmptyState text="暂无可配置技能。" />
                        ) : null}
                      </div>
                    ) : null}

                    {activeTab === 'bindings' ? (
                      <div className="space-y-4">
                        {selectedBindings.length ? (
                          <div className="space-y-2">
                            {selectedBindings.map((binding) => (
                              <BindingCard key={`${binding.type}-${binding.label}-${binding.agentId}`} binding={binding} />
                            ))}
                          </div>
                        ) : (
                          <EmptyState text="该智能体当前没有可展示的 Route / ACP 绑定。" />
                        )}
                      </div>
                    ) : null}

                    {activeTab === 'memory' ? (
                      <AgentMemoryPanel
                        data={memoryData}
                        files={memoryFiles}
                        error={memoryError}
                        selectedPath={selectedMemoryPath}
                        selectedFile={selectedMemoryFile}
                        content={memoryContent}
                        query={memoryQuery}
                        searchData={memorySearchData}
                        searchError={memorySearchError}
                        isLoading={memoryState === 'loading'}
                        isFileBusy={memoryFileState === 'loading' || memoryFileState === 'saving'}
                        isSearching={memorySearchState === 'loading'}
                        isIndexing={memoryIndexState === 'running'}
                        onSelectPath={setSelectedMemoryPath}
                        onContentChange={setMemoryContent}
                        onQueryChange={setMemoryQuery}
                        onSearch={() => void runAgentMemorySearch()}
                        onClearSearch={() => {
                          setMemorySearchData(null)
                          setMemorySearchError('')
                        }}
                        onIndex={() => void runAgentMemoryIndex()}
                        onCopy={() => void copyAgentMemoryContent()}
                        onDownload={downloadAgentMemoryContent}
                      />
                    ) : null}

                    {activeTab === 'files' ? (
                      <div className="space-y-3">
                        {selectedFiles.length && selectedFile ? (
                          <>
                            {fileError ? (
                              <div className="rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">{fileError}</div>
                            ) : null}

                            <textarea
                              value={fileContent}
                              onChange={(event) => setFileContent(event.target.value)}
                              spellCheck={false}
                              className={`min-h-[calc(100vh-270px)] w-full resize-y rounded-2xl border border-divider bg-surface-secondary/50 px-4 py-4 font-mono text-sm leading-6 text-foreground outline-none transition-colors placeholder:text-muted focus:border-accent ${fileState === 'loading' || fileState === 'saving' ? 'pointer-events-none opacity-60' : ''}`}
                              placeholder="文件内容为空，可在这里编辑后更新。"
                            />

                            <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-secondary/50 px-4 py-3">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-foreground">{selectedFile.name}</p>
                                <p className="mt-1 truncate text-xs text-muted">{selectedFile.path}</p>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <Button isIconOnly size="sm" variant="ghost" aria-label="复制文件内容" onPress={copyAgentFileContent}>
                                  <Icon icon="lucide:copy" className="size-4" />
                                </Button>
                                <Button isIconOnly size="sm" variant="ghost" aria-label="下载文件" onPress={downloadAgentFileContent}>
                                  <Icon icon="lucide:download" className="size-4" />
                                </Button>
                              </div>
                            </div>
                          </>
                        ) : (
                          <EmptyState text="暂无工作区 bootstrap 文件信息。" />
                        )}
                      </div>
                    ) : null}
                  </div>
                </Card.Content>
              </Card>

              {activeTab !== 'files' && activeTab !== 'skills' && activeTab !== 'memory' ? (
                <Card>
                  <Card.Header>
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon icon="lucide:layout-dashboard" className="size-5 text-muted" />
                      <div className="min-w-0">
                        <Card.Title>配置摘要</Card.Title>
                      </div>
                    </div>
                  </Card.Header>
                  <Card.Content>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <MiniInfo label="Defaults Workspace" value={data.defaults.workspace || '-'} />
                      <MiniInfo label="Agent Dir Root" value={data.defaults.agentDirRoot || '-'} />
                      <MiniInfo label="Session Store Template" value={data.defaults.sessionStore || '-'} />
                      <MiniInfo label="Bindings" value={String(bindings.length)} />
                    </div>

                    <div className="space-y-3 mt-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm text-muted">当前智能体的脱敏配置片段，便于核对字段是否按预期解析。</p>
                        <Chip size="sm" variant="soft">{selectedAgent?.config ? 'has config' : 'no config'}</Chip>
                      </div>
                      <pre className="max-h-[52vh] overflow-auto rounded-2xl bg-surface-secondary/50 p-4 text-xs leading-6 text-foreground">
                        {rawConfigText}
                      </pre>
                    </div>
                  </Card.Content>
                </Card>
              ) : null}
            </div>
          </section>
        ) : null}

        {detailState === 'loading' && !detailData ? <div className="sr-only">加载智能体详情中</div> : null}

        <AgentDeleteConfirmDialog
          agent={selectedAgent}
          isOpen={deleteDialogOpen}
          isDeleting={deleteState === 'deleting'}
          onOpenChange={setDeleteDialogOpen}
          onConfirm={uninstallAgent}
        />
      </div>
    </DashboardLayout>
  )
}

const emptyAdvancedSettingsForm: OpenClawAgentAdvancedSettingsForm = {
  default: false,
  model: '',
  modelFallbacks: '',
  thinkingDefault: '',
  reasoningDefault: '',
  verboseDefault: '',
  fastModeDefault: false,
  temperature: '',
  topP: '',
  maxTokens: '',
  toolsProfile: '',
  toolsAllow: '',
  toolsDeny: '',
  sandboxMode: '',
  sandboxScope: '',
  workspaceAccess: '',
  allowAgents: '',
}

function initialsForAgent(agent: OpenClawAgentSummary) {
  return (agent.name || agent.id || '--').slice(0, 2).toUpperCase()
}

function runtimeLabel(agent: OpenClawAgentSummary) {
  const parts = [agent.runtime.type]
  if (agent.runtime.id) parts.push(agent.runtime.id)
  if (agent.runtime.backend) parts.push(agent.runtime.backend)
  return parts.filter(Boolean).join(' · ') || '-'
}
function getAgentSkillsMode(agent: OpenClawAgentSummary, defaultSkills?: string[]) {
  if (Object.prototype.hasOwnProperty.call(agent.config ?? {}, 'skills')) return 'explicit'
  if (defaultSkills?.length) return 'inherited'
  return 'unrestricted'
}

function resolveAgentSkillSelection(agent: OpenClawAgentSummary, defaultSkills: string[] | undefined) {
  if (getAgentSkillsMode(agent, defaultSkills) === 'unrestricted') return []
  return (agent.skills ?? []).slice().sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

function sameStringSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((item) => set.has(item))
}

function sameAdvancedSettingsForm(a: OpenClawAgentAdvancedSettingsForm, b: OpenClawAgentAdvancedSettingsForm) {
  return (Object.keys(emptyAdvancedSettingsForm) as Array<keyof OpenClawAgentAdvancedSettingsForm>).every((key) => a[key] === b[key])
}

function configObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function buildAgentModelOptions(content: Record<string, unknown>): AgentModelOption[] {
  const modelsConfig = configObject(content.models)
  const providers = configObject(modelsConfig.providers)
  const options: AgentModelOption[] = []
  const seen = new Set<string>()

  for (const [providerKey, providerValue] of Object.entries(providers)) {
    const provider = configObject(providerValue) as OpenClawModelProvider
    const providerModels = Array.isArray(provider.models) ? provider.models : []

    for (const item of providerModels) {
      const model = typeof item === 'string'
        ? { id: item } satisfies OpenClawModelDefinition
        : configObject(item) as OpenClawModelDefinition
      const modelId = String(model.id ?? '').trim()
      if (!modelId) continue

      const value = `${providerKey}/${modelId}`
      if (seen.has(value)) continue
      seen.add(value)

      options.push({
        label: String(model.name || modelId),
        modelId,
        providerKey,
        value,
      })
    }
  }

  return options.sort((a, b) => a.providerKey.localeCompare(b.providerKey, 'zh-CN') || a.label.localeCompare(b.label, 'zh-CN'))
}

function stringFromConfig(value: unknown) {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function boolFromConfig(value: unknown) {
  return value === true || value === 'true'
}

function numberStringFromConfig(value: unknown) {
  return typeof value === 'number' || typeof value === 'string' ? String(value) : ''
}

function csvFromConfig(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).join(', ')
  if (typeof value === 'string') return value
  return ''
}

function csvToList(value: string) {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
}

function optionalNumber(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : trimmed
}

function resolveAgentAdvancedSettingsForm(agent: OpenClawAgentSummary): OpenClawAgentAdvancedSettingsForm {
  const config = agent.config ?? {}
  const model = configObject(config.model)
  const params = configObject(config.params)
  const tools = configObject(config.tools)
  const sandbox = configObject(config.sandbox)
  const subagents = configObject(config.subagents)

  return {
    default: agent.isDefault || boolFromConfig(config.default),
    model: stringFromConfig(model.primary) || agent.model || '',
    modelFallbacks: csvFromConfig(model.fallbacks),
    thinkingDefault: stringFromConfig(config.thinkingDefault),
    reasoningDefault: stringFromConfig(config.reasoningDefault),
    verboseDefault: stringFromConfig(config.verboseDefault),
    fastModeDefault: boolFromConfig(config.fastModeDefault),
    temperature: numberStringFromConfig(params.temperature),
    topP: numberStringFromConfig(params.topP),
    maxTokens: numberStringFromConfig(params.maxTokens),
    toolsProfile: stringFromConfig(tools.profile),
    toolsAllow: csvFromConfig(tools.allow),
    toolsDeny: csvFromConfig(tools.deny),
    sandboxMode: stringFromConfig(sandbox.mode),
    sandboxScope: stringFromConfig(sandbox.scope),
    workspaceAccess: stringFromConfig(sandbox.workspaceAccess),
    allowAgents: csvFromConfig(subagents.allowAgents),
  }
}

function buildAgentAdvancedSettingsRequest(agentId: string, value: OpenClawAgentAdvancedSettingsForm): OpenClawAgentMutationRequest {
  const params: Record<string, unknown> = {}
  const temperature = optionalNumber(value.temperature)
  const topP = optionalNumber(value.topP)
  const maxTokens = optionalNumber(value.maxTokens)
  if (temperature !== undefined) params.temperature = temperature
  if (topP !== undefined) params.topP = topP
  if (maxTokens !== undefined) params.maxTokens = maxTokens

  const tools: Record<string, unknown> = {}
  if (value.toolsProfile.trim()) tools.profile = value.toolsProfile.trim()
  tools.allow = csvToList(value.toolsAllow)
  tools.deny = csvToList(value.toolsDeny)

  const sandbox: Record<string, unknown> = {}
  if (value.sandboxMode.trim()) sandbox.mode = value.sandboxMode.trim()
  if (value.sandboxScope.trim()) sandbox.scope = value.sandboxScope.trim()
  if (value.workspaceAccess.trim()) sandbox.workspaceAccess = value.workspaceAccess.trim()

  const subagents: Record<string, unknown> = { allowAgents: csvToList(value.allowAgents) }

  return {
    id: agentId,
    default: value.default,
    model: value.model.trim(),
    modelFallbacks: csvToList(value.modelFallbacks),
    thinkingDefault: value.thinkingDefault.trim(),
    reasoningDefault: value.reasoningDefault.trim(),
    verboseDefault: value.verboseDefault.trim(),
    fastModeDefault: value.fastModeDefault,
    params,
    tools,
    sandbox,
    subagents,
  }
}

function getAgentSkillStatus(skill: OpenClawSkillStatus): { label: string; className: string } | null {
  if (skill.disabled) return { label: '已停用', className: 'bg-danger' }
  if (skill.blockedByAllowlist || skill.blockedByAgentFilter) return { label: '被过滤', className: 'bg-warning' }
  if (hasMissingSkillRequirement(skill)) return { label: '缺依赖', className: 'bg-warning' }
  if (skill.eligible) return { label: '可用', className: 'bg-success' }
  return null
}

function hasMissingSkillRequirement(skill: OpenClawSkillStatus) {
  const missing = skill.missing
  return Boolean((missing?.bins?.length || 0) > 0 || (missing?.anyBins?.length || 0) > 0 || (missing?.env?.length || 0) > 0 || (missing?.config?.length || 0) > 0 || (missing?.os?.length || 0) > 0)
}

function agentSkillsStatusLabel(mode: 'explicit' | 'inherited' | 'unrestricted') {
  if (mode === 'explicit') return '显式配置'
  if (mode === 'inherited') return '继承 defaults'
  return '不限制'
}

function agentWorkspaceFileLabel(name: string) {
  const labels: Record<string, string> = {
    'AGENTS.md': '操作指令',
    'SOUL.md': '人格与语气',
    'TOOLS.md': '工具约定',
    'IDENTITY.md': '身份信息',
    'USER.md': '用户信息',
    'HEARTBEAT.md': '心跳清单',
    'BOOTSTRAP.md': '首次启动流程',
    'MEMORY.md': '长期记忆',
  }
  return labels[name] ?? name.replace(/\.md$/i, '')
}

function AgentMemoryPanel({
  data,
  files,
  error,
  selectedPath,
  selectedFile,
  content,
  query,
  searchData,
  searchError,
  isLoading,
  isFileBusy,
  isSearching,
  isIndexing,
  onSelectPath,
  onContentChange,
  onQueryChange,
  onSearch,
  onClearSearch,
  onIndex,
  onCopy,
  onDownload,
}: {
  data: OpenClawAgentMemoryResponse | null
  files: OpenClawAgentMemoryFile[]
  error: string
  selectedPath: string
  selectedFile: OpenClawAgentMemoryFile | null
  content: string
  query: string
  searchData: OpenClawAgentMemorySearchResponse | null
  searchError: string
  isLoading: boolean
  isFileBusy: boolean
  isSearching: boolean
  isIndexing: boolean
  onSelectPath: (path: string) => void
  onContentChange: (content: string) => void
  onQueryChange: (query: string) => void
  onSearch: () => void
  onClearSearch: () => void
  onIndex: () => void
  onCopy: () => void
  onDownload: () => void
}) {
  const hasSearchResults = Boolean(searchData)

  return (
    <div className="space-y-4">
      {error ? <div className="rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">{error}</div> : null}

      <div className="grid gap-3 md:grid-cols-4">
        <MemoryMetricCard icon="lucide:database" label="索引" value={data?.index.exists ? '已创建' : '未创建'} tone={data?.index.exists ? 'success' : 'warning'} detail={formatBytes(data?.index.size)} />
        <MemoryMetricCard icon="lucide:file-text" label="文件" value={String(data?.summary.filesCount ?? files.length)} detail={formatBytes(data?.summary.totalBytes)} />
        <MemoryMetricCard icon="lucide:folder-search" label="memory_search" value={data?.cli.available ? '可用' : '未就绪'} tone={data?.cli.available ? 'success' : 'warning'} detail={data?.cli.error || data?.cli.command || '-'} />
        <MemoryMetricCard icon="lucide:clock-3" label="最近更新" value={formatDateTime(data?.summary.updatedAt)} detail={formatDateTime(data?.index.updatedAt)} />
      </div>

      <div className="rounded-2xl bg-surface-secondary/50 p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="font-semibold text-foreground">记忆检索</p>
            <p className="mt-1 truncate text-xs text-muted">{searchData?.source === 'local' ? 'memory_search 不可用，当前显示本地 Markdown 搜索结果' : '调用 OpenClaw memory_search，返回索引命中的记忆片段'}</p>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:justify-end">
            <SearchField className="min-w-0 sm:max-w-md sm:flex-1" value={query} onChange={onQueryChange} aria-label="搜索记忆">
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input
                  placeholder="搜索长期记忆、日期记录..."
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') onSearch()
                  }}
                />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            <div className="flex gap-2">
              {hasSearchResults ? (
                <Button size="sm" variant="tertiary" onPress={onClearSearch}>
                  <Icon icon="lucide:x" className="size-4" />
                  清除
                </Button>
              ) : null}
              <Button size="sm" variant="primary" onPress={onSearch} isDisabled={isSearching || !query.trim()}>
                <Icon icon={isSearching ? 'lucide:loader-circle' : 'lucide:search'} className={`size-4 ${isSearching ? 'animate-spin' : ''}`} />
                搜索
              </Button>
              <Button size="sm" variant="tertiary" onPress={onIndex} isDisabled={isIndexing}>
                <Icon icon={isIndexing ? 'lucide:loader-circle' : 'lucide:refresh-ccw'} className={`size-4 ${isIndexing ? 'animate-spin' : ''}`} />
                重建索引
              </Button>
            </div>
          </div>
        </div>

        {searchError ? <div className="mt-3 rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">{searchError}</div> : null}

        {searchData ? (
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {searchData.results.length ? searchData.results.map((hit, index) => (
              <button
                key={`${hit.relativePath || hit.path || index}-${index}`}
                type="button"
                className="min-w-0 rounded-2xl bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-tertiary"
                onClick={() => {
                  if (hit.relativePath) onSelectPath(hit.relativePath)
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-semibold text-foreground">{hit.title || memoryFileFriendlyLabel(hit.relativePath || hit.path || '')}</p>
                  {hit.score ? <Chip size="sm" variant="soft">{formatScore(hit.score)}</Chip> : null}
                </div>
                <p className="mt-1 truncate text-xs text-muted">{hit.relativePath || hit.path || '-'}</p>
                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-muted">{hit.snippet}</p>
              </button>
            )) : (
              <EmptyState text="没有搜索结果。" />
            )}
          </div>
        ) : null}
      </div>

      <div className="grid min-h-[calc(100dvh-380px)] gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col rounded-2xl bg-surface-secondary/50 p-3">
          <div className="flex items-center justify-between gap-3 px-1 pb-3">
            <div className="min-w-0">
              <p className="font-semibold text-foreground">记忆文件</p>
              <p className="mt-1 text-xs text-muted">{data?.memoryDir || 'memory/*.md'}</p>
            </div>
            {isLoading ? <Icon icon="lucide:loader-circle" className="size-4 animate-spin text-muted" /> : <Chip size="sm" variant="soft">{files.length}</Chip>}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {files.length ? (
              <RadioButtonGroup
                aria-label="记忆文件"
                className="w-full gap-2"
                name="openclaw-memory-files"
                value={selectedPath}
                variant="secondary"
                onChange={(value) => onSelectPath(String(value))}
              >
                {files.map((file) => {
                  return (
                    <RadioButtonGroup.Item
                      key={file.relativePath}
                      className="min-w-0 flex w-full flex-row items-center"
                      value={file.relativePath}
                    >
                      <RadioButtonGroup.ItemIcon className={`flex size-9 shrink-0 items-center justify-center rounded-full ${file.exists ? 'bg-background-tertiary text-foreground' : 'bg-warning/10 text-warning'}`}>
                        <Icon icon={file.kind === 'root' ? 'lucide:brain' : 'lucide:file-clock'} className="size-4" />
                      </RadioButtonGroup.ItemIcon>
                      <RadioButtonGroup.ItemContent className="min-w-0">
                        <Label className="block truncate text-sm font-medium">{memoryFileFriendlyLabel(file.relativePath)}</Label>
                        <Description className="mt-1 block truncate text-xs">
                          {memoryKindLabel(file)} · {formatBytes(file.size)} · {formatDateTime(file.updatedAt)}
                        </Description>
                      </RadioButtonGroup.ItemContent>
                      <RadioButtonGroup.Indicator />
                    </RadioButtonGroup.Item>
                  )
                })}
              </RadioButtonGroup>
            ) : (
              <EmptyState text="暂无记忆文件。" />
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col rounded-2xl bg-surface-secondary/50 p-3">
          <div className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 px-1">
              <p className="truncate font-semibold text-foreground">{selectedFile ? memoryFileFriendlyLabel(selectedFile.relativePath) : '记忆内容'}</p>
              <p className="mt-1 truncate text-xs text-muted">{selectedFile?.path || '选择左侧文件查看内容'}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button isIconOnly size="sm" variant="ghost" aria-label="复制记忆内容" onPress={onCopy} isDisabled={!selectedFile || isFileBusy}>
                <Icon icon="lucide:copy" className="size-4" />
              </Button>
              <Button isIconOnly size="sm" variant="ghost" aria-label="下载记忆文件" onPress={onDownload} isDisabled={!selectedFile || isFileBusy}>
                <Icon icon="lucide:download" className="size-4" />
              </Button>
            </div>
          </div>

          {/* {fileError ? <div className="mb-3 rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">{fileError}</div> : null} */}

          <textarea
            value={content}
            onChange={(event) => onContentChange(event.target.value)}
            spellCheck={false}
            className={`min-h-[360px] flex-1 resize-none rounded-2xl border border-divider bg-surface px-4 py-4 font-mono text-sm leading-6 text-foreground outline-none transition-colors placeholder:text-muted focus:border-accent ${isFileBusy ? 'pointer-events-none opacity-60' : ''}`}
            placeholder="记忆文件为空，可在这里编辑后保存。"
          />
        </div>
      </div>
    </div>
  )
}

function MemoryMetricCard({ icon, label, value, detail, tone = 'neutral' }: { icon: string; label: string; value: string; detail?: string; tone?: 'neutral' | 'success' | 'warning' }) {
  const colorClass = tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-muted'
  return (
    <div className="rounded-2xl bg-surface-secondary/50 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted">{label}</span>
        <Icon icon={icon} className={`size-4 ${colorClass}`} />
      </div>
      <p className="mt-2 truncate text-sm font-semibold text-foreground">{value || '-'}</p>
      <p className="mt-1 truncate text-xs text-muted">{detail || '-'}</p>
    </div>
  )
}

function memoryFileFriendlyLabel(path: string) {
  if (!path) return '-'
  if (path === 'MEMORY.md') return '长期记忆'
  const base = path.split('/').pop() || path
  return base.replace(/\.md$/i, '').replace(/[-_]/g, ' ')
}

function memoryKindLabel(file: OpenClawAgentMemoryFile) {
  if (!file.exists) return '未创建'
  return file.kind === 'root' ? '核心' : '记录'
}

function formatBytes(value?: number) {
  if (!value) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function formatDateTime(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatScore(value: number) {
  if (!Number.isFinite(value)) return '-'
  return value >= 10 ? value.toFixed(0) : value.toFixed(2)
}

function AgentSkillCard({
  skill,
  isSelected,
  isDisabled,
  onChange,
}: {
  skill: OpenClawSkillStatus
  isSelected: boolean
  isDisabled: boolean
  onChange: (isSelected: boolean) => void
}) {
  const key = skill.skillKey || skill.name
  const status = getAgentSkillStatus(skill)

  return (
    <Checkbox
      id={`agent-skill-${key}`}
      className="self-start rounded-2xl border border-divider bg-surface p-4 transition-colors data-[selected=true]:border-accent data-[selected=true]:bg-accent/5"
      isDisabled={isDisabled}
      isSelected={isSelected}
      onChange={onChange}
    >
      <div className="flex items-start gap-3">

        <Checkbox.Content className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg leading-none">{skill.emoji || '✦'}</span>
                <Label htmlFor={`agent-skill-${key}`} className="truncate font-semibold text-foreground">{skill.name}</Label>
              </div>

            </div>
            <div className="shrink-0 flex items-center gap-2">
              {status ? <span aria-label={status.label} title={status.label} className={`size-2.5 rounded-full ${status.className}`} /> : null}
              <Checkbox.Control className="shrink-0">
                <Checkbox.Indicator />
              </Checkbox.Control>
            </div>
          </div>
          <Description className="mt-2 line-clamp-2 text-sm leading-6">{skill.description || '无描述'}</Description>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {skill.bundled ? <Chip size="sm" variant="soft">内置</Chip> : null}
            {skill.source ? <Chip size="sm" variant="soft">{skill.source}</Chip> : null}
            {skill.skillKey ? <Chip size="sm" variant="soft">{skill.skillKey}</Chip> : null}
          </div>
        </Checkbox.Content>
      </div>
    </Checkbox>
  )
}

function BindingCard({ binding }: { binding: OpenClawAgentBinding }) {
  return (
    <div className="rounded-2xl bg-surface-secondary/50 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-foreground">{binding.label}</p>
          <p className="mt-1 text-xs text-muted">agent {binding.agentId}</p>
        </div>
        <Chip size="sm" variant="soft">
          {binding.type}
        </Chip>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {binding.channel ? <Chip size="sm" variant="soft">channel: {binding.channel}</Chip> : null}
        {binding.accountId ? <Chip size="sm" variant="soft">account: {binding.accountId}</Chip> : null}
        {binding.guildId ? <Chip size="sm" variant="soft">guild: {binding.guildId}</Chip> : null}
        {binding.teamId ? <Chip size="sm" variant="soft">team: {binding.teamId}</Chip> : null}
        {binding.peerKind || binding.peerId ? <Chip size="sm" variant="soft">peer: {[binding.peerKind, binding.peerId].filter(Boolean).join(':')}</Chip> : null}
      </div>
    </div>
  )
}

function AgentDeleteConfirmDialog({
  agent,
  isOpen,
  isDeleting,
  onConfirm,
  onOpenChange,
}: {
  agent: OpenClawAgentSummary | null
  isOpen: boolean
  isDeleting: boolean
  onConfirm: () => Promise<void>
  onOpenChange: (isOpen: boolean) => void
}) {
  return (
    <AlertDialog.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <AlertDialog.Container>
        <AlertDialog.Dialog className="sm:max-w-[480px]">
          <AlertDialog.CloseTrigger />
          <AlertDialog.Header>
            <AlertDialog.Icon status="danger" />
            <AlertDialog.Heading>卸载智能体？</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <div className="space-y-3 text-sm leading-6 text-muted">
              <p>
                这会从 openclaw.json 中移除 <span className="font-semibold text-foreground">{agent?.name || agent?.id}</span>，并清理关联绑定与状态目录。
              </p>
              <div className="rounded-2xl bg-surface-tertiary px-3 py-3">
                <p className="break-all">Workspace: {agent?.workspace || '-'}</p>
                <p className="mt-1 break-all">Agent Dir: {agent?.agentDir || '-'}</p>
              </div>
              <p>如果 Workspace 被其他智能体共享，将自动保留。</p>
            </div>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button slot="close" variant="tertiary" isDisabled={isDeleting}>
              取消
            </Button>
            <Button
              variant="danger"
              onPress={() => void onConfirm()}
              isDisabled={isDeleting || !agent || agent.isDefault}
            >
              <Icon icon={isDeleting ? 'lucide:loader-circle' : 'lucide:trash-2'} className={isDeleting ? 'animate-spin' : ''} />
              确认卸载
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  )
}

function DefaultAgentItemCard({ value, isSaving, onChange }: { value: boolean; isSaving: boolean; onChange: (value: boolean) => void }) {
  return (
    <ItemCard variant="secondary">
      <ItemCard.Icon>
        <Icon icon="lucide:star" />
      </ItemCard.Icon>
      <ItemCard.Content>
        <ItemCard.Title>设为默认Agent</ItemCard.Title>
        <ItemCard.Description>开启后保存，会把当前智能体写为默认，并清理其它默认项。</ItemCard.Description>
      </ItemCard.Content>
      <ItemCard.Action>
        <Switch size="lg" aria-label="设为默认Agent" isSelected={value} isDisabled={isSaving} onChange={onChange}>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch>
      </ItemCard.Action>
    </ItemCard>
  )
}

function AdvancedSettingsCards({
  value,
  bindingsCount,
  activeSection,
  hasChanges,
  isSaving,
  error,
  onSectionChange,
  onChange,
  onSave,
}: {
  value: OpenClawAgentAdvancedSettingsForm
  bindingsCount: number
  activeSection: 'reasoning' | 'tools' | 'routing'
  hasChanges: boolean
  isSaving: boolean
  error: string
  onSectionChange: (section: 'reasoning' | 'tools' | 'routing') => void
  onChange: <K extends keyof OpenClawAgentAdvancedSettingsForm>(key: K, value: OpenClawAgentAdvancedSettingsForm[K]) => void
  onSave: () => Promise<void>
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {error ? <div className="rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">{error}</div> : null}
      <DefaultAgentItemCard
        value={value.default}
        isSaving={isSaving}
        onChange={(isDefault) => onChange('default', isDefault)}
      />
      <div className="flex flex-col gap-3 rounded-2xl bg-surface-secondary/50 p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Segment selectedKey={activeSection} onSelectionChange={(key) => onSectionChange(key as 'reasoning' | 'tools' | 'routing')}>
            <Segment.Item id="reasoning">
              <Segment.Separator />
              推理级别
            </Segment.Item>
            <Segment.Item id="tools">
              <Segment.Separator />
              工具与权限
            </Segment.Item>
            <Segment.Item id="routing">
              <Segment.Separator />
              路由与上下文
            </Segment.Item>
          </Segment>
          <Button size="sm" variant="primary" onPress={() => void onSave()} isDisabled={!hasChanges || isSaving}>
            <Icon icon={isSaving ? 'lucide:loader-circle' : 'lucide:save'} className={isSaving ? 'animate-spin' : ''} />
            保存
          </Button>
        </div>

        {activeSection === 'reasoning' ? (
          <ItemCardGroup className="overflow-hidden">
            <ItemCard>
              <ItemCard.Icon><Icon icon="lucide:brain" /></ItemCard.Icon>
              <ItemCard.Content>
                <ItemCard.Title>思考深度</ItemCard.Title>
                <ItemCard.Description>默认思考深度，覆盖 agents.defaults.thinkingDefault。</ItemCard.Description>
              </ItemCard.Content>
              <ItemCard.Action>
                <AdvancedInlineSelect ariaLabel="思考深度" value={value.thinkingDefault} options={thinkingOptions} isDisabled={isSaving} onChange={(nextValue) => onChange('thinkingDefault', nextValue)} />
              </ItemCard.Action>
            </ItemCard>
            <Separator />
            <ItemCard>
              <ItemCard.Icon><Icon icon="lucide:radio" /></ItemCard.Icon>
              <ItemCard.Content>
                <ItemCard.Title>推理可见性</ItemCard.Title>
                <ItemCard.Description>reasoning 输出模式。</ItemCard.Description>
              </ItemCard.Content>
              <ItemCard.Action>
                <AdvancedInlineSelect ariaLabel="推理可见性" value={value.reasoningDefault} options={reasoningOptions} isDisabled={isSaving} onChange={(nextValue) => onChange('reasoningDefault', nextValue)} />
              </ItemCard.Action>
            </ItemCard>
            <Separator />
            <ItemCard>
              <ItemCard.Icon><Icon icon="lucide:gauge" /></ItemCard.Icon>
              <ItemCard.Content>
                <ItemCard.Title>详细输出 / 快速模式</ItemCard.Title>
                <ItemCard.Description>控制详细输出与快速模式默认值。</ItemCard.Description>
              </ItemCard.Content>
              <ItemCard.Action>
                <div className="flex items-center gap-2">
                  <AdvancedInlineSelect ariaLabel="详细输出" value={value.verboseDefault} options={verboseOptions} isDisabled={isSaving} onChange={(nextValue) => onChange('verboseDefault', nextValue)} />
                  <Switch aria-label="快速模式" isSelected={value.fastModeDefault} isDisabled={isSaving} onChange={(isSelected) => onChange('fastModeDefault', isSelected)}>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                  </Switch>
                </div>
              </ItemCard.Action>
            </ItemCard>
            <Separator />
            <ItemCard>
              <ItemCard.Icon><Icon icon="lucide:sliders-horizontal" /></ItemCard.Icon>
              <ItemCard.Content>
                <ItemCard.Title>模型参数</ItemCard.Title>
                <ItemCard.Description>temperature、topP、maxTokens。</ItemCard.Description>
              </ItemCard.Content>
              <ItemCard.Action>
                <div className="grid w-64 grid-cols-3 gap-2">
                  <Input variant="secondary" aria-label="Temperature" placeholder="温度" value={value.temperature} disabled={isSaving} onChange={(event) => onChange('temperature', event.target.value)} />
                  <Input variant="secondary" aria-label="Top P" placeholder="Top P" value={value.topP} disabled={isSaving} onChange={(event) => onChange('topP', event.target.value)} />
                  <Input variant="secondary" aria-label="Max Tokens" placeholder="最大 Token" value={value.maxTokens} disabled={isSaving} onChange={(event) => onChange('maxTokens', event.target.value)} />
                </div>
              </ItemCard.Action>
            </ItemCard>
          </ItemCardGroup>
        ) : null}

        {activeSection === 'tools' ? (
          <ItemCardGroup className="overflow-hidden">
            <ItemCard>
              <ItemCard.Icon><Icon icon="lucide:wrench" /></ItemCard.Icon>
              <ItemCard.Content>
                <ItemCard.Title>工具配置档</ItemCard.Title>
                <ItemCard.Description>选择最接近用途的工具权限预设。</ItemCard.Description>
              </ItemCard.Content>
              <ItemCard.Action>
                <AdvancedInlineSelect ariaLabel="工具配置档" value={value.toolsProfile} options={toolsProfileOptions} isDisabled={isSaving} onChange={(nextValue) => onChange('toolsProfile', nextValue)} />
              </ItemCard.Action>
            </ItemCard>
            <Separator />
            <ItemCard>
              <ItemCard.Icon><Icon icon="lucide:list-checks" /></ItemCard.Icon>
              <ItemCard.Content>
                <ItemCard.Title>允许工具</ItemCard.Title>
                <ItemCard.Description>逗号或换行分隔的工具名。</ItemCard.Description>
              </ItemCard.Content>
              <ItemCard.Action>
                <Input variant="secondary" aria-label="允许工具" placeholder="允许" value={value.toolsAllow} disabled={isSaving} onChange={(event) => onChange('toolsAllow', event.target.value)} />
              </ItemCard.Action>
            </ItemCard>
            <Separator />
            <ItemCard>
              <ItemCard.Icon><Icon icon="lucide:list-checks" /></ItemCard.Icon>
              <ItemCard.Content>
                <ItemCard.Title>禁止工具</ItemCard.Title>
                <ItemCard.Description>逗号或换行分隔的工具名。</ItemCard.Description>
              </ItemCard.Content>
              <ItemCard.Action>
                <Input variant="secondary" aria-label="禁止工具" placeholder="禁止" value={value.toolsDeny} disabled={isSaving} onChange={(event) => onChange('toolsDeny', event.target.value)} />
              </ItemCard.Action>
            </ItemCard>
            <Separator />
            <ItemCard>
              <ItemCard.Icon><Icon icon="lucide:shield" /></ItemCard.Icon>
              <ItemCard.Content>
                <ItemCard.Title>沙箱策略</ItemCard.Title>
                <ItemCard.Description>隔离模式、作用域与 workspace 访问。</ItemCard.Description>
              </ItemCard.Content>
              <ItemCard.Action>
             
                  <AdvancedInlineSelect ariaLabel="沙箱模式" value={value.sandboxMode} options={sandboxModeOptions} isDisabled={isSaving} onChange={(nextValue) => onChange('sandboxMode', nextValue)} />
                  {/* <Input variant="secondary" aria-label="沙箱作用域" placeholder="作用域" value={value.sandboxScope} disabled={isSaving} onChange={(event) => onChange('sandboxScope', event.target.value)} />
                  <Input variant="secondary" aria-label="Workspace 访问" placeholder="访问" value={value.workspaceAccess} disabled={isSaving} onChange={(event) => onChange('workspaceAccess', event.target.value)} /> */}
              
              </ItemCard.Action>
            </ItemCard>
          </ItemCardGroup>
        ) : null}

        {activeSection === 'routing' ? (
          <ItemCardGroup className="overflow-hidden">
            <ItemCard>
              <ItemCard.Icon><Icon icon="lucide:route" /></ItemCard.Icon>
              <ItemCard.Content>
                <ItemCard.Title>Bindings</ItemCard.Title>
                <ItemCard.Description>当前已关联 {bindingsCount} 条 Route / ACP 绑定，详细规则在 Bindings 标签查看。</ItemCard.Description>
              </ItemCard.Content>
              <ItemCard.Action>
                <Chip size="sm" variant="soft">{bindingsCount}</Chip>
              </ItemCard.Action>
            </ItemCard>
            <Separator />
            <ItemCard>
              <ItemCard.Icon><Icon icon="lucide:network" /></ItemCard.Icon>
              <ItemCard.Content>
                <ItemCard.Title>Fallback</ItemCard.Title>
                <ItemCard.Description>模型 fallback 与 subagents.allowAgents。</ItemCard.Description>
              </ItemCard.Content>
              <ItemCard.Action>
              <Input variant="secondary" aria-label="模型 Fallback" placeholder="Fallback 模型" value={value.modelFallbacks} disabled={isSaving} onChange={(event) => onChange('modelFallbacks', event.target.value)} />
              </ItemCard.Action>
            </ItemCard>
            <Separator />
            <ItemCard>
              <ItemCard.Icon><Icon icon="lucide:network" /></ItemCard.Icon>
              <ItemCard.Content>
                <ItemCard.Title>Subagents</ItemCard.Title>
                <ItemCard.Description>模型 fallback 与 subagents.allowAgents。</ItemCard.Description>
              </ItemCard.Content>
              <ItemCard.Action>
              <Input variant="secondary" aria-label="允许子智能体" placeholder="允许子智能体" value={value.allowAgents} disabled={isSaving} onChange={(event) => onChange('allowAgents', event.target.value)} />
              </ItemCard.Action>
            </ItemCard>
          </ItemCardGroup>
        ) : null}
      </div>
    </div>
  )
}

function AdvancedInlineSelect({
  ariaLabel,
  value,
  options,
  isDisabled,
  onChange,
}: {
  ariaLabel: string
  value: string
  options: Array<{ id: string; label: string }>
  isDisabled: boolean
  onChange: (value: string) => void
}) {
  const label = options.find((option) => option.id === value)?.label ?? '继承'

  return (
    <InlineSelect aria-label={ariaLabel} value={value || 'inherit'} isDisabled={isDisabled} onChange={(nextValue) => onChange(nextValue === 'inherit' ? '' : String(nextValue))}>
      <InlineSelect.Trigger className="max-w-full">
        <InlineSelect.Value>{label}</InlineSelect.Value>
        <InlineSelect.Indicator />
      </InlineSelect.Trigger>
      <InlineSelect.Popover>
        <ListBox>
          <ListBox.Item id="inherit" textValue="继承">
            继承
            <ListBox.ItemIndicator />
          </ListBox.Item>
          {options.map((option) => (
            <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </InlineSelect.Popover>
    </InlineSelect>
  )
}

const thinkingOptions = [
  { id: 'off', label: '关闭思考' },
  { id: 'minimal', label: '极简思考' },
  { id: 'low', label: '低推理' },
  { id: 'medium', label: '中等推理' },
  { id: 'high', label: '高推理' },
  { id: 'xhigh', label: '超高推理' },
  { id: 'adaptive', label: '自适应' },
  { id: 'max', label: '最大推理' },
]

const reasoningOptions = [
  { id: 'off', label: '不显示推理' },
  { id: 'on', label: '显示推理' },
  { id: 'stream', label: '流式推理' },
]

const verboseOptions = [
  { id: 'off', label: '简洁输出' },
  { id: 'on', label: '详细输出' },
  { id: 'full', label: '完整输出' },
]

const toolsProfileOptions = [
  { id: 'minimal', label: '最小权限' },
  { id: 'coding', label: '编码工具' },
  { id: 'messaging', label: '消息工具' },
  { id: 'full', label: '完整权限' },
]

const sandboxModeOptions = [
  { id: 'off', label: '关闭沙箱' },
  { id: 'host', label: '本机环境' },
  { id: 'docker', label: 'Docker 沙箱' },
]

function AgentModelSelect({
  value,
  options,
  error,
  isDisabled,
  onChange,
}: {
  value: string
  options: AgentModelOption[]
  error: string
  isDisabled: boolean
  onChange: (value: string) => void
}) {
  const selectedOption = options.find((option) => option.value === value)
  const hasMissingCurrentModel = Boolean(value && !selectedOption && options.length)

  if (!options.length) {
    return (
      <div className="rounded-2xl bg-warning/10 px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm leading-6 text-warning">
            {error || '暂无已添加模型，请先去模型配置添加模型。'}
          </div>
          <Button
            size="sm"
            variant="tertiary"
            onPress={() => {
              window.location.href = '/dashboard/openclaw-models'
            }}
          >
            <Icon icon="lucide:plus" className="size-4" />
            添加模型
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Dropdown>
        <Button
          className="h-auto min-h-11 w-full justify-between rounded-2xl px-3 py-2 text-left"
          variant="secondary"
          isDisabled={isDisabled}
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">
                {selectedOption?.label ?? '选择模型'}
              </span>
              <span className="block truncate text-xs text-muted">
                {selectedOption?.value ?? '从已添加模型中选择'}
              </span>
            </span>
          </span>
          <Icon icon="lucide:chevron-down" className="size-4 shrink-0 text-muted" />
        </Button>
        <Dropdown.Popover className="min-w-[auto]" placement="bottom start">
          <Dropdown.Menu selectedKeys={new Set(selectedOption ? [selectedOption.value] : [])} selectionMode="single" onAction={(key) => onChange(String(key))}>
            {options.map((option) => (
              <Dropdown.Item key={option.value} id={option.value} textValue={`${option.label} ${option.value}`}>
                <Dropdown.ItemIndicator />
                <div className="min-w-0">
                  <Label className="truncate">{option.label}</Label>
                  <p className="mt-1 truncate text-xs text-muted">{option.providerKey}/{option.modelId}</p>
                </div>
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
      {hasMissingCurrentModel ? (
        <p className="text-xs leading-5 text-warning">
          当前模型不在已添加模型中，请重新选择。
        </p>
      ) : null}
    </div>
  )
}

function AgentConfigModal({
  isOpen,
  mode,
  value,
  error,
  isSaving,
  modelOptions,
  modelConfigError,
  children,
  onChange,
  onCancel,
  onSave,
}: {
  isOpen: boolean
  mode: 'create' | 'edit'
  value: { id: string; name: string; emoji: string; model: string; workspace: string }
  error: string
  isSaving: boolean
  modelOptions: AgentModelOption[]
  modelConfigError: string
  children: ReactNode
  onChange: (value: { id: string; name: string; emoji: string; model: string; workspace: string }) => void
  onCancel: () => void
  onSave: () => Promise<boolean>
}) {
  const update = (key: keyof typeof value, nextValue: string) => onChange({ ...value, [key]: nextValue })
  const title = mode === 'create' ? '新建智能体' : '编辑智能体'

  return (
    <Modal>
      {children}
      <Modal.Backdrop isOpen={isOpen} onOpenChange={(open) => {
        if (!open) onCancel()
      }}>
        <Modal.Container placement="auto" size="md" scroll="inside">
          <Modal.Dialog className="sm:max-w-[420px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
                <Icon icon={mode === 'create' ? 'lucide:bot-message-square' : 'lucide:bot'} className="size-5" />
              </Modal.Icon>
              <div className="min-w-0">
                <Modal.Heading>{title}</Modal.Heading>
              </div>
            </Modal.Header>
            <Modal.Body>
              <Card>
                <div className="space-y-4">
                  {error ? <div className="rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">{error}</div> : null}
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="openclaw-agent-id" className="text-xs font-medium text-muted">Agent ID</Label>
                      <Input
                        id="openclaw-agent-id"
                        fullWidth
                        variant="secondary"
                        value={value.id}
                        onChange={(event) => update('id', event.target.value)}
                        disabled={mode === 'edit' || isSaving}
                        placeholder="work"
                      />
                    </div>
                    <div className="grid grid-cols-[auto_1fr] gap-4 md:col-span-2">
                      <EmojiPickerField
                        value={value.emoji}
                        isDisabled={isSaving}
                        onChange={(emoji) => update('emoji', emoji)}
                      />
                      <div className="min-w-0 space-y-2">
                        <Label htmlFor="openclaw-agent-name" className="text-xs font-medium text-muted">名称</Label>
                        <Input
                          id="openclaw-agent-name"
                          fullWidth
                          variant="secondary"
                          value={value.name}
                          onChange={(event) => update('name', event.target.value)}
                          disabled={isSaving}
                          placeholder="Work Agent"
                        />
                      </div>
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label className="text-xs font-medium text-muted">模型</Label>
                      <AgentModelSelect
                        value={value.model}
                        options={modelOptions}
                        error={modelConfigError}
                        isDisabled={isSaving}
                        onChange={(model) => update('model', model)}
                      />
                    </div>
                    {mode === 'edit' ? (
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="openclaw-agent-workspace" className="text-xs font-medium text-muted">Workspace</Label>
                        <Input
                          id="openclaw-agent-workspace"
                          fullWidth
                          variant="secondary"
                          value={value.workspace}
                          onChange={(event) => update('workspace', event.target.value)}
                          disabled={isSaving}
                          placeholder="留空时使用 ~/.openclaw/agents/{agentId}/workspace"
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              </Card>
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" variant="ghost" onPress={onCancel} isDisabled={isSaving}>取消</Button>
              <Button
                variant="primary"
                onPress={async () => {
                  const saved = await onSave()
                  if (saved) onCancel()
                }}
                isDisabled={isSaving || !modelOptions.length || !value.model.trim()}
              >
                <Icon icon={isSaving ? 'lucide:loader-circle' : 'lucide:save'} className={isSaving ? 'animate-spin' : ''} />
                {mode === 'create' ? '创建' : '保存'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface-secondary/50 px-3 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-2 break-all text-sm font-medium text-foreground line-clamp-1">{value || '-'}</div>
    </div>
  )
}

function StatusTile({ label, ok, text }: { label: string; ok: boolean; text: string }) {
  return (
    <div className="rounded-2xl bg-surface-secondary/50 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">{label}</span>
        <Chip size="sm" variant="soft" color={ok ? 'success' : 'danger'}>
          {ok ? '正常' : '异常'}
        </Chip>
      </div>
      <div className="mt-2 text-sm font-medium text-foreground">{text}</div>
    </div>
  )
}

function MiniInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface-secondary/50 px-3 py-3">
      <div className="truncate text-xs text-muted">{label}</div>
      <div className="mt-2 truncate text-sm font-medium text-foreground">{value || '-'}</div>
    </div>
  )
}

type AgentReadyStats = ReturnType<typeof buildAgentReadyStats>
type AgentReadyChartData = Array<{ name: string; value: number; fill: string }>

function AgentReadyPieChart({ stats, chartData }: { stats: AgentReadyStats; chartData: AgentReadyChartData }) {
  const fallbackData = [{ name: '暂无数据', value: 1, fill: 'var(--surface-secondary)' }]
  const displayData = chartData.length ? chartData : fallbackData

  return (
    <Card className="h-full">
      <Card.Content className="flex h-full items-center">
        <div className="flex w-full flex-row items-center gap-6">
          <div className="relative shrink-0">
            <PieChart height={160} width={160}>
              <PieChart.Pie
                cx="50%"
                cy="50%"
                data={displayData}
                dataKey="value"
                innerRadius="56%"
                nameKey="name"
                strokeWidth={0}
              >
                {displayData.map((item) => (
                  <PieChart.Cell key={item.name} fill={item.fill} />
                ))}
              </PieChart.Pie>
              <PieChart.Tooltip content={<PieChart.TooltipContent />} />
            </PieChart>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-bold tabular-nums text-foreground">{stats.ready}</span>
              <span className="text-[10px] text-muted">完全就绪</span>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <AgentReadyLegendItem label="完全就绪" value={stats.ready} color="var(--success)" />
            <AgentReadyLegendItem label="部分就绪" value={stats.partial} color="var(--warning)" />
            <AgentReadyLegendItem label="未就绪" value={stats.notReady} color="var(--danger)" />
            <div className="mt-1 grid grid-cols-3 gap-2 border-t border-divider pt-3 text-center">
              <MiniReadyMetric label="Workspace" value={stats.workspace} total={stats.total} />
              <MiniReadyMetric label="Agent Dir" value={stats.agentDir} total={stats.total} />
              <MiniReadyMetric label="Session" value={stats.sessionStore} total={stats.total} />
            </div>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function AgentReadyLegendItem({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <div className="flex flex-1 items-center justify-between gap-3">
        <span className="text-sm text-foreground">{label}</span>
        <span className="text-sm font-semibold tabular-nums text-foreground">{value}</span>
      </div>
    </div>
  )
}

function MiniReadyMetric({ label, value, total }: { label: string; value: number; total: number }) {
  return (
    <div className="min-w-0">
      <div className="text-sm font-semibold tabular-nums text-foreground">{value}/{total}</div>
      <div className="mt-1 truncate text-[10px] text-muted">{label}</div>
    </div>
  )
}

function InlineError({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl bg-warning/10 p-4">
      <div className="flex items-start gap-3 text-warning">
        <Icon icon="lucide:triangle-alert" className="mt-0.5 size-5" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{title}</p>
          <p className="mt-1 text-sm text-muted">{message}</p>
        </div>
        <Button size="sm" variant="tertiary" onPress={onRetry}>
          重试
        </Button>
      </div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-2xl bg-surface-secondary/50 px-3 py-4 text-sm text-muted">{text}</div>
}

function buildAgentReadyStats(agents: OpenClawAgentSummary[]) {
  return agents.reduce((acc, agent) => {
    const readyFields = [agent.workspaceExists, agent.agentDirExists, agent.sessionStoreExists].filter(Boolean).length
    acc.total += 1
    if (agent.workspaceExists) acc.workspace += 1
    if (agent.agentDirExists) acc.agentDir += 1
    if (agent.sessionStoreExists) acc.sessionStore += 1
    if (readyFields === 3) acc.ready += 1
    else if (readyFields > 0) acc.partial += 1
    else acc.notReady += 1
    return acc
  }, { total: 0, ready: 0, partial: 0, notReady: 0, workspace: 0, agentDir: 0, sessionStore: 0 })
}

function PageSkeleton() {
  return (
    <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
      <Skeleton className="h-[520px] rounded-3xl" />
      <div className="space-y-6">
        <Skeleton className="h-[360px] rounded-3xl" />
        <Skeleton className="h-[180px] rounded-3xl" />
      </div>
    </div>
  )
}

export default OpenClawAgentsPage

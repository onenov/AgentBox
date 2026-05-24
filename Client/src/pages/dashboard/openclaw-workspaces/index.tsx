import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, Key } from 'react'
import Editor from '@monaco-editor/react'
import type { OpenClawAgentSummary, OpenClawAgentsResponse, OpenClawWorkspaceFileResponse, OpenClawWorkspaceNode, OpenClawWorkspaceTreeResponse, OpenClawWorkspaceTreeSummary } from '@/api'
import { createOpenClawAgentWorkspaceEntry, deleteOpenClawAgentWorkspaceEntry, getOpenClawAgentWorkspaceFile, getOpenClawAgentWorkspaceTree, listOpenClawAgents, moveOpenClawAgentWorkspaceEntry, updateOpenClawAgentWorkspaceFile } from '@/api'
import { Breadcrumbs, Button, Card, Chip, Dropdown, InputGroup, Label, ListBox, Modal, SearchField, Skeleton, TextField, Tooltip, toast } from '@heroui/react'
import { CellSelect, DropZone, FileTree } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import DashboardLayout from '@/layouts/Dashboard'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useThemeStore } from '@/stores/theme'

type LoadState = 'idle' | 'loading' | 'ready' | 'error'
type FileState = LoadState
type WorkspaceEntryType = 'file' | 'directory'
type MutationState = 'idle' | 'saving' | 'deleting' | 'moving'
type UploadFileStatus = 'uploading' | 'complete' | 'failed'
type UploadFileItem = {
  id: string
  name: string
  size: number
  status: UploadFileStatus
  progress: number
}

const protectedWorkspaceFiles = new Set(['AGENTS.md', 'HEARTBEAT.md', 'IDENTITY.md', 'SOUL.md', 'TOOLS.md', 'USER.md'])
const workspacePreviewMaxBytes = 10 * 1024 * 1024
const workspaceUploadMaxBytes = 10 * 1024 * 1024

function OpenClawWorkspacesPage() {
  usePageTitle('文件管理')
  const theme = useThemeStore((state) => state.resolvedTheme)
  const editorTheme = theme === 'dark' ? 'vs-dark' : 'vs'
  const [agentsState, setAgentsState] = useState<LoadState>('idle')
  const [agentsData, setAgentsData] = useState<OpenClawAgentsResponse | null>(null)
  const [agentsError, setAgentsError] = useState('')
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [treeState, setTreeState] = useState<LoadState>('idle')
  const [treeData, setTreeData] = useState<OpenClawWorkspaceTreeResponse | null>(null)
  const [treeError, setTreeError] = useState('')
  const [fileState, setFileState] = useState<FileState>('idle')
  const [fileData, setFileData] = useState<OpenClawWorkspaceFileResponse | null>(null)
  const [fileError, setFileError] = useState('')
  const [selectedPath, setSelectedPath] = useState('')
  const [filter, setFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createType, setCreateType] = useState<WorkspaceEntryType>('file')
  const [createName, setCreateName] = useState('')
  const [createParent, setCreateParent] = useState('.')
  const [createError, setCreateError] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveTarget, setMoveTarget] = useState('.')
  const [moveError, setMoveError] = useState('')
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [mutationState, setMutationState] = useState<MutationState>('idle')
  const [uploadMode, setUploadMode] = useState(false)
  const [draftContent, setDraftContent] = useState('')
  const [isDraftDirty, setIsDraftDirty] = useState(false)
  const [previewHistory, setPreviewHistory] = useState<string[]>([])
  const [previewHistoryIndex, setPreviewHistoryIndex] = useState(-1)

  const agents = useMemo(() => agentsData?.agents ?? [], [agentsData?.agents])
  const selectedAgent = useMemo(() => agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null, [agents, selectedAgentId])
  const filteredRoot = useMemo(() => filterWorkspaceTree(treeData?.root, filter), [filter, treeData?.root])
  const flattenedNodes = useMemo(() => flattenWorkspaceNodes(treeData?.root), [treeData?.root])
  const selectedNode = useMemo(() => flattenedNodes.find((item) => item.node.relativePath === selectedPath)?.node ?? null, [flattenedNodes, selectedPath])
  const selectedDirectory = useMemo(() => currentDirectoryForSelection(selectedNode), [selectedNode])
  const uploadTargetDirectory = useMemo(() => selectedDirectory || '.', [selectedDirectory])
  const canUploadToSelectedDirectory = Boolean(selectedAgentId && uploadTargetDirectory !== '.')
  const selectedKeys = useMemo(() => selectedPaths, [selectedPaths])
  const selectedBulkNodes = useMemo(() => selectedPaths.map((path) => flattenedNodes.find((item) => item.node.relativePath === path)?.node).filter((node): node is OpenClawWorkspaceNode => Boolean(node)), [flattenedNodes, selectedPaths])
  const actionableSelectedNodes = useMemo(() => selectedBulkNodes.filter((node) => node.relativePath !== '.' && !isProtectedWorkspaceNode(node)), [selectedBulkNodes])
  const expandedKeys = useMemo(() => flattenedNodes.filter((item) => item.node.type === 'directory' && item.depth === 0).map((item) => item.node.relativePath), [flattenedNodes])
  const canPreview = Boolean(fileData?.file.readable && !fileData.dataUrl)
  const canSaveDraft = Boolean(selectedAgentId && fileData?.file.readable && !fileData.dataUrl && selectedNode?.type === 'file' && isDraftDirty && mutationState !== 'saving')
  const canDeleteSelected = Boolean(selectedNode && selectedNode.relativePath !== '.' && !isProtectedWorkspaceNode(selectedNode))
  const canGoBackPreview = previewHistoryIndex > 0
  const canGoForwardPreview = previewHistoryIndex >= 0 && previewHistoryIndex < previewHistory.length - 1
  const isFilePreviewMode = selectedNode?.type === 'file'

  const loadAgents = useCallback(async () => {
    setAgentsState('loading')
    setAgentsError('')

    try {
      const payload = await listOpenClawAgents()
      setAgentsData(payload)
      setAgentsState('ready')
      setSelectedAgentId((current) => current || payload.agents[0]?.id || '')
    } catch (err) {
      setAgentsError(err instanceof Error ? err.message : '智能体列表加载失败')
      setAgentsState('error')
    }
  }, [])

  const loadTree = useCallback(async (agentId: string, preservePath = '') => {
    if (!agentId) return
    setTreeState('loading')
    setTreeError('')
    setFileData(null)
    setDraftContent('')
    setIsDraftDirty(false)
    setFileError('')
    if (!preservePath) {
      setSelectedPath('')
      setSelectedPaths([])
      setPreviewHistory([])
      setPreviewHistoryIndex(-1)
    }

    try {
      const payload = await getOpenClawAgentWorkspaceTree(agentId, { depth: 6, maxEntries: 1000 })
      setTreeData(payload)
      setTreeState('ready')
      if (preservePath) {
        setSelectedPath(preservePath)
        setSelectedPaths([preservePath])
        setPreviewHistory([preservePath])
        setPreviewHistoryIndex(0)
      }
    } catch (err) {
      setTreeData(null)
      setTreeError(err instanceof Error ? err.message : '工作区文件树加载失败')
      setTreeState('error')
    }
  }, [])

  const loadFile = useCallback(async (agentId: string, path: string) => {
    if (!agentId || !path || path === '.') return
    setFileState('loading')
    setFileError('')

    try {
      const payload = await getOpenClawAgentWorkspaceFile(agentId, path, { maxBytes: workspacePreviewMaxBytes })
      setFileData(payload)
      setDraftContent(payload.content ?? '')
      setIsDraftDirty(false)
      setFileState('ready')
    } catch (err) {
      setFileData(null)
      setDraftContent('')
      setIsDraftDirty(false)
      setFileError(err instanceof Error ? err.message : '工作区文件读取失败')
      setFileState('error')
    }
  }, [])

  const openPreviewPath = useCallback((path: string) => {
    const item = flattenedNodes.find((node) => node.node.relativePath === path)?.node
    if (!item) return
    setUploadMode(false)
    setSelectedPath(item.relativePath)
    if (item.type === 'file' && selectedAgentId) {
      void loadFile(selectedAgentId, item.relativePath)
    } else {
      setFileData(null)
      setDraftContent('')
      setIsDraftDirty(false)
      setFileError('')
      setFileState('idle')
    }
  }, [flattenedNodes, loadFile, selectedAgentId])

  const previewPath = useCallback((path: string) => {
    openPreviewPath(path)
    setPreviewHistory((current) => {
      const normalizedIndex = previewHistoryIndex >= 0 ? previewHistoryIndex : current.length - 1
      if (current[normalizedIndex] === path) return current
      const next = [...current.slice(0, normalizedIndex + 1), path]
      setPreviewHistoryIndex(next.length - 1)
      return next
    })
  }, [openPreviewPath, previewHistoryIndex])

  const selectPath = useCallback((path: string, paths?: string[]) => {
    const nextPaths = resolveWorkspaceSelectionChange(paths?.length ? paths : [path], selectedPaths, flattenedNodes)
    setSelectedPaths(nextPaths)
  }, [flattenedNodes, selectedPaths])

  const goPreviewHistory = useCallback((offset: -1 | 1) => {
    const nextIndex = previewHistoryIndex + offset
    const nextPath = previewHistory[nextIndex]
    if (!nextPath) return
    setPreviewHistoryIndex(nextIndex)
    openPreviewPath(nextPath)
  }, [openPreviewPath, previewHistory, previewHistoryIndex])

  const closeFilePreview = useCallback(() => {
    if (!selectedNode || selectedNode.type !== 'file') return
    previewPath(parentWorkspacePath(selectedNode.relativePath))
  }, [previewPath, selectedNode])

  const refreshTree = useCallback(() => {
    if (!selectedAgentId) return
    void loadTree(selectedAgentId, selectedPath)
  }, [loadTree, selectedAgentId, selectedPath])

  const openCreateDialog = useCallback((type: WorkspaceEntryType) => {
    setCreateType(type)
    setCreateParent(selectedDirectory)
    setCreateName('')
    setCreateError('')
    setCreateOpen(true)
  }, [selectedDirectory])

  const createEntry = useCallback(async () => {
    if (!selectedAgentId) return
    const path = joinWorkspacePath(createParent, createName.trim())
    const validation = validateClientWorkspaceName(createName)
    if (validation) {
      setCreateError(validation)
      return
    }
    setMutationState('saving')
    setCreateError('')

    try {
      await createOpenClawAgentWorkspaceEntry(selectedAgentId, { path, type: createType })
      toast.success(createType === 'directory' ? '文件夹已创建' : '文件已创建')
      setCreateOpen(false)
      await loadTree(selectedAgentId, path)
      if (createType === 'file') await loadFile(selectedAgentId, path)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '创建失败')
      toast.warning('创建失败')
    } finally {
      setMutationState('idle')
    }
  }, [createName, createParent, createType, loadFile, loadTree, selectedAgentId])

  const deleteEntry = useCallback(async () => {
    if (!selectedAgentId || !selectedNode || !canDeleteSelected) return
    const parent = parentWorkspacePath(selectedNode.relativePath)
    setMutationState('deleting')

    try {
      await deleteOpenClawAgentWorkspaceEntry(selectedAgentId, { path: selectedNode.relativePath })
      toast.success(selectedNode.type === 'directory' ? '文件夹已删除' : '文件已删除')
      setDeleteOpen(false)
      setSelectedPaths([])
      setFileData(null)
      setDraftContent('')
      setIsDraftDirty(false)
      setFileError('')
      await loadTree(selectedAgentId, parent)
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '删除失败')
    } finally {
      setMutationState('idle')
    }
  }, [canDeleteSelected, loadTree, selectedAgentId, selectedNode])

  const deleteSelectedEntries = useCallback(async () => {
    if (!selectedAgentId || actionableSelectedNodes.length === 0) return
    const parent = parentWorkspacePath(actionableSelectedNodes[0].relativePath)
    setMutationState('deleting')

    try {
      for (const node of actionableSelectedNodes) {
        await deleteOpenClawAgentWorkspaceEntry(selectedAgentId, { path: node.relativePath })
      }
      toast.success(`${actionableSelectedNodes.length} 项已删除`)
      setBulkDeleteOpen(false)
      setSelectedPaths([])
      setFileData(null)
      setDraftContent('')
      setIsDraftDirty(false)
      setFileError('')
      await loadTree(selectedAgentId, parent)
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '批量删除失败')
    } finally {
      setMutationState('idle')
    }
  }, [actionableSelectedNodes, loadTree, selectedAgentId])

  const moveSelectedEntries = useCallback(async () => {
    if (!selectedAgentId || actionableSelectedNodes.length === 0) return
    const targetPath = moveTarget.trim() || '.'
    setMutationState('moving')
    setMoveError('')

    try {
      for (const node of actionableSelectedNodes) {
        await moveOpenClawAgentWorkspaceEntry(selectedAgentId, { path: node.relativePath, targetPath })
      }
      toast.success(`${actionableSelectedNodes.length} 项已移动`)
      setMoveOpen(false)
      setSelectedPaths([])
      setFileData(null)
      setDraftContent('')
      setIsDraftDirty(false)
      setFileError('')
      await loadTree(selectedAgentId, targetPath)
    } catch (err) {
      const message = err instanceof Error ? err.message : '移动失败'
      setMoveError(message)
      toast.warning(message)
    } finally {
      setMutationState('idle')
    }
  }, [actionableSelectedNodes, loadTree, moveTarget, selectedAgentId])

  const uploadWorkspaceFiles = useCallback(async (directoryPath: string, files: File[]) => {
    if (!selectedAgentId || files.length === 0) return
    if (directoryPath === '.') {
      toast.warning('不允许上传文件到工作区根目录，请先选择或创建子文件夹')
      throw new Error('cannot upload to workspace root')
    }
    const oversizedFiles = files.filter((file) => file.size > workspaceUploadMaxBytes)
    if (oversizedFiles.length) {
      toast.warning(`单个文件不能超过 ${formatBytes(workspaceUploadMaxBytes)}：${oversizedFiles.map((file) => file.name).join('、')}`)
      throw new Error('file too large')
    }
    setMutationState('saving')

    try {
      for (const file of files) {
        const contentBase64 = await fileToBase64(file)
        await createOpenClawAgentWorkspaceEntry(selectedAgentId, {
          path: joinWorkspacePath(directoryPath, file.name),
          type: 'file',
          contentBase64,
        })
      }
      toast.success(files.length === 1 ? '文件已上传' : `${files.length} 个文件已上传`)
      await loadTree(selectedAgentId, directoryPath)
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '上传失败')
      throw err
    } finally {
      setMutationState('idle')
    }
  }, [loadTree, selectedAgentId])

  const saveFileContent = useCallback(async () => {
    if (!selectedAgentId || !fileData?.file || !canSaveDraft) return
    setMutationState('saving')

    try {
      await updateOpenClawAgentWorkspaceFile(selectedAgentId, { path: fileData.file.relativePath, content: draftContent })
      toast.success('文件已保存')
      setIsDraftDirty(false)
      await loadTree(selectedAgentId, fileData.file.relativePath)
      await loadFile(selectedAgentId, fileData.file.relativePath)
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '保存失败')
    } finally {
      setMutationState('idle')
    }
  }, [canSaveDraft, draftContent, fileData?.file, loadFile, loadTree, selectedAgentId])

  const copyFileContent = useCallback(async () => {
    if (!draftContent) return
    try {
      await navigator.clipboard.writeText(draftContent)
      toast.success('文件内容已复制')
    } catch {
      toast.warning('复制失败')
    }
  }, [draftContent])

  const downloadFileContent = useCallback(() => {
    if (!fileData?.file || !draftContent) return
    const blob = new Blob([draftContent], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileData.file.name || 'workspace-file.txt'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, [draftContent, fileData?.file])

  useEffect(() => {
    void loadAgents()
  }, [loadAgents])

  useEffect(() => {
    if (selectedAgentId) {
      void loadTree(selectedAgentId)
    }
  }, [loadTree, selectedAgentId])

  useEffect(() => {
    if (uploadMode && !canUploadToSelectedDirectory) setUploadMode(false)
  }, [canUploadToSelectedDirectory, uploadMode])

  return (
    <DashboardLayout>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-6">
              <div className="flex h-24 shrink-0 items-center justify-center overflow-visible p-1">
                <img
                  src="https://assets.orence.net/file/20260515150119843.png"
                  alt="OpenClaw File"
                  className="h-full w-auto"
                />
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">工作区文件</h1>
                <p className="mt-1 max-w-2xl text-sm text-muted">浏览 OpenClaw Agent 的 workspace 文件树，安全预览文本内容。</p>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {canUploadToSelectedDirectory || uploadMode ? (
              <Tooltip delay={300}>
                <Button variant={uploadMode ? 'primary' : 'tertiary'} isDisabled={!canUploadToSelectedDirectory && !uploadMode} onPress={() => setUploadMode((current) => !current)} aria-label={uploadMode ? '关闭上传' : '上传文件'}>
                  <Icon icon={uploadMode ? 'lucide:x' : 'lucide:upload'} className="size-4" />
                  {uploadMode ? '关闭上传' : '上传文件'}
                </Button>
                <Tooltip.Content>{uploadMode ? '关闭上传' : '上传到当前目录'}</Tooltip.Content>
              </Tooltip>
            ) : null}
            <AgentSelect agents={agents} isLoading={agentsState === 'loading'} value={selectedAgentId} onChange={setSelectedAgentId} />
            <Tooltip delay={300}>
              <Button isIconOnly variant="ghost" onPress={refreshTree} isDisabled={!selectedAgentId || treeState === 'loading'} aria-label="刷新文件树">
                <Icon icon={treeState === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={`size-4 ${treeState === 'loading' ? 'animate-spin' : ''}`} />
              </Button>
              <Tooltip.Content>刷新文件树</Tooltip.Content>
            </Tooltip>
          </div>
        </div>

        {agentsError ? <div className="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">{agentsError}</div> : null}

        <div className="grid h-[calc(100dvh-220px)] gap-1 xl:grid-cols-[380px_minmax(0,1fr)]">
          <Card className="flex min-h-0 flex-col overflow-hidden">
            <Card.Header className="flex-col items-start gap-3">
              <div className="flex w-full items-center justify-between gap-3">
                <div className="min-w-0">
                  <Card.Title className="truncate text-xl font-semibold">{selectedAgent ? agentLabel(selectedAgent) : '未选择'}</Card.Title>
                  {/* <Card.Description>{selectedAgent?.workspace || '暂无 workspace'}</Card.Description> */}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {treeData ? <Chip variant="soft">{flattenedNodes.length}</Chip> : null}
                  {selectedBulkNodes.length ? (
                    <WorkspaceBulkActionsMenu
                      count={selectedBulkNodes.length}
                      disabled={mutationState !== 'idle'}
                      onDelete={() => setBulkDeleteOpen(true)}
                      onMove={() => {
                        setMoveTarget(selectedDirectory || '.')
                        setMoveError('')
                        setMoveOpen(true)
                      }}
                    />
                  ) : null}
                  <Dropdown>
                    <Button isIconOnly variant="tertiary" isDisabled={!selectedAgentId || treeState === 'loading'} aria-label="新建工作区项目">
                      <Icon icon="lucide:plus" className="size-4" />
                    </Button>
                    <Dropdown.Popover className="min-w-[auto]" placement="bottom end">
                      <Dropdown.Menu aria-label="新建工作区项目">
                        <Dropdown.Item id="file" textValue="新建文件" onAction={() => openCreateDialog('file')}>
                          <Icon icon="lucide:file-plus-2" className="size-4 text-muted" />
                          <Label>新建文件</Label>
                        </Dropdown.Item>
                        <Dropdown.Item id="directory" textValue="新建文件夹" onAction={() => openCreateDialog('directory')}>
                          <Icon icon="lucide:folder-plus" className="size-4 text-muted" />
                          <Label>新建文件夹</Label>
                        </Dropdown.Item>
                      </Dropdown.Menu>
                    </Dropdown.Popover>
                  </Dropdown>
                </div>
              </div>
              <SearchField aria-label="搜索文件" value={filter} onChange={setFilter} className="w-full">
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder="搜索文件或路径" />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
            </Card.Header>
            <Card.Content className="flex min-h-0 flex-1 flex-col p-0">
              <div className="min-h-0 flex-1 overflow-y-auto">
                <WorkspaceFileTree
                  error={treeError}
                  expandedKeys={expandedKeys}
                  isLoading={treeState === 'loading'}
                  root={filteredRoot}
                  selectedKeys={selectedKeys}
                  onPreviewPath={previewPath}
                  onSelectPaths={selectPath}
                />
              </div>
              <div className="shrink-0 pt-2">
                {selectedAgent?.workspace ? <span className="text-sm text-muted">{selectedAgent.workspace}</span> : null}
                <WorkspaceStats summary={treeData?.summary ?? null} totalSize={workspaceTotalSize(treeData?.root)} />
              </div>
            </Card.Content>
          </Card>

          <Card className="flex min-h-0 flex-col overflow-hidden">
            <Card.Header className="flex-col items-start gap-3">
              <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-2">
                  {canGoBackPreview || canGoForwardPreview ? (
                    <div className="flex shrink-0 items-center gap-1 border-r border-divider pr-2 pt-0.5">
                      {canGoBackPreview ? (
                        <Tooltip delay={300}>
                          <Button isIconOnly size="sm" variant="tertiary" isDisabled={uploadMode} onPress={() => goPreviewHistory(-1)} aria-label="后退">
                            <Icon icon="lucide:arrow-left" className="size-4" />
                          </Button>
                          <Tooltip.Content>后退</Tooltip.Content>
                        </Tooltip>
                      ) : null}
                      {canGoForwardPreview ? (
                        <Tooltip delay={300}>
                          <Button isIconOnly size="sm" variant="tertiary" isDisabled={uploadMode} onPress={() => goPreviewHistory(1)} aria-label="前进">
                            <Icon icon="lucide:arrow-right" className="size-4" />
                          </Button>
                          <Tooltip.Content>前进</Tooltip.Content>
                        </Tooltip>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="min-w-0">
                    <Card.Title>{fileData?.file.name || selectedNode?.name || '文件视图'}</Card.Title>
                    <div className="mt-1 min-w-0">
                      <WorkspaceBreadcrumbs selectedPath={selectedPath} onSelectPath={previewPath} />
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {isDraftDirty ? (
                    <Tooltip delay={300}>
                      <Button isIconOnly variant="secondary" isDisabled={!canSaveDraft || uploadMode} isPending={mutationState === 'saving'} onPress={saveFileContent} aria-label="保存文件">
                        <Icon icon="lucide:save" className="size-4" />
                      </Button>
                      <Tooltip.Content>保存文件</Tooltip.Content>
                    </Tooltip>
                  ) : null}
                  <Tooltip delay={300}>
                    <Button isIconOnly variant="ghost" isDisabled={!canPreview || uploadMode} onPress={copyFileContent} aria-label="复制内容">
                      <Icon icon="lucide:copy" className="size-4" />
                    </Button>
                    <Tooltip.Content>复制内容</Tooltip.Content>
                  </Tooltip>
                  <Tooltip delay={300}>
                    <Button isIconOnly variant="ghost" isDisabled={!canPreview || uploadMode} onPress={downloadFileContent} aria-label="下载文本文件">
                      <Icon icon="lucide:download" className="size-4" />
                    </Button>
                    <Tooltip.Content>下载文本文件</Tooltip.Content>
                  </Tooltip>
                  <Tooltip delay={300}>
                    <Button isIconOnly variant="danger-soft" isDisabled={!canDeleteSelected || uploadMode} onPress={() => setDeleteOpen(true)} aria-label="删除">
                      <Icon icon="lucide:trash-2" className="size-4" />
                    </Button>
                    <Tooltip.Content>{selectedNode && isProtectedWorkspaceNode(selectedNode) ? '核心文件不可删除' : '删除'}</Tooltip.Content>
                  </Tooltip>
                  {isFilePreviewMode ? (
                    <Tooltip delay={300}>
                      <Button isIconOnly variant="tertiary" isDisabled={uploadMode} onPress={closeFilePreview} aria-label="关闭预览">
                        <Icon icon="lucide:x" className="size-4" />
                      </Button>
                      <Tooltip.Content>关闭预览，返回文件夹</Tooltip.Content>
                    </Tooltip>
                  ) : null}
                </div>
              </div>
            </Card.Header>
            <Card.Content className="min-h-0 flex-1 pt-0">
              {uploadMode ? (
                <WorkspaceUploadPanel targetDirectory={uploadTargetDirectory} onUploadFiles={uploadWorkspaceFiles} />
              ) : (
                <FilePreview
                  content={draftContent}
                  data={fileData}
                  editorTheme={editorTheme}
                  error={fileError}
                  isLoading={fileState === 'loading'}
                  selectedNode={selectedNode}
                  onContentChange={(value) => {
                    setDraftContent(value)
                    setIsDraftDirty(value !== (fileData?.content ?? ''))
                  }}
                  onSelectPath={previewPath}
                  onUploadFiles={uploadWorkspaceFiles}
                />
              )}
            </Card.Content>
          </Card>
        </div>
      </div>

      <CreateEntryModal
        error={createError}
        isOpen={createOpen}
        isSaving={mutationState === 'saving'}
        name={createName}
        parent={createParent}
        type={createType}
        onNameChange={setCreateName}
        onOpenChange={setCreateOpen}
        onSubmit={createEntry}
      />
      <DeleteEntryModal
        isDeleting={mutationState === 'deleting'}
        isOpen={deleteOpen}
        node={selectedNode}
        onOpenChange={setDeleteOpen}
        onSubmit={deleteEntry}
      />
      <BulkDeleteEntriesModal
        isDeleting={mutationState === 'deleting'}
        isOpen={bulkDeleteOpen}
        nodes={actionableSelectedNodes}
        totalCount={selectedBulkNodes.length}
        onOpenChange={setBulkDeleteOpen}
        onSubmit={deleteSelectedEntries}
      />
      <MoveEntriesModal
        error={moveError}
        isMoving={mutationState === 'moving'}
        isOpen={moveOpen}
        nodes={actionableSelectedNodes}
        target={moveTarget}
        totalCount={selectedBulkNodes.length}
        onOpenChange={setMoveOpen}
        onSubmit={moveSelectedEntries}
        onTargetChange={setMoveTarget}
      />
    </DashboardLayout>
  )
}

function AgentSelect({ agents, isLoading, onChange, value }: { agents: OpenClawAgentSummary[]; isLoading: boolean; onChange: (value: string) => void; value: string }) {
  const selectedAgent = agents.find((agent) => agent.id === value)

  return (
    <CellSelect aria-label="选择 Agent" className="w-auto" isDisabled={isLoading || agents.length === 0} value={value || null} variant="secondary" onChange={(key: Key | null) => onChange(String(key ?? ''))}>
      <CellSelect.Trigger>
        <CellSelect.Value>
          {() => selectedAgent ? (
            <span className="flex min-w-0 items-center text-center">
              <span className="flex size-8 shrink-0 items-center justify-center text-base">{selectedAgent.identity.emoji || '🤖'}</span>
              <span className="truncate text-sm font-semibold">{agentLabel(selectedAgent)}</span>
            </span>
          ) : (
            <span className="text-muted">{isLoading ? '加载智能体...' : '选择 Agent'}</span>
          )}
        </CellSelect.Value>
        <CellSelect.Indicator />
      </CellSelect.Trigger>
      <CellSelect.Popover>
        <ListBox>
          {agents.map((agent) => (
            <ListBox.Item key={agent.id} id={agent.id} textValue={agentLabel(agent)}>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-background-tertiary text-base">{agent.identity.emoji || '🤖'}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold">{agentLabel(agent)}</span>
                <span className="truncate text-xs text-muted">{agent.workspace}</span>
              </span>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </CellSelect.Popover>
    </CellSelect>
  )
}

function WorkspaceStats({ summary, totalSize }: { summary: OpenClawWorkspaceTreeSummary | null; totalSize: number }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-2xl bg-surface-secondary/50 px-4 py-3">
      <div className="flex min-w-0 items-center gap-4 text-sm font-semibold text-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Icon icon="lucide:folder" className="size-4 text-primary" />
          {summary?.directories ?? 0}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Icon icon="lucide:file" className="size-4 text-muted" />
          {summary?.files ?? 0}
        </span>
      </div>
      <span className="shrink-0 text-sm font-semibold text-foreground">{formatBytes(totalSize)}</span>
    </div>
  )
}

function WorkspaceBulkActionsMenu({ count, disabled, onDelete, onMove }: { count: number; disabled: boolean; onDelete: () => void; onMove: () => void }) {
  return (
    <Dropdown>
      <Button variant="primary" isDisabled={disabled} aria-label="批量操作">
        <Icon icon="lucide:list-checks" className="size-4" />
        操作 {count}
      </Button>
      <Dropdown.Popover className="min-w-[auto]" placement="bottom end">
        <Dropdown.Menu aria-label="批量操作">
          <Dropdown.Item id="move" textValue="移动到目标文件夹" onAction={onMove}>
            <Icon icon="lucide:folder-input" className="size-4 text-muted" />
            <Label>移动到目标文件夹</Label>
          </Dropdown.Item>
          <Dropdown.Item id="delete" textValue="批量删除" onAction={onDelete}>
            <Icon icon="lucide:trash-2" className="size-4 text-danger" />
            <Label className="text-danger">批量删除</Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

function WorkspaceFileTree({ error, expandedKeys, isLoading, onPreviewPath, onSelectPaths, root, selectedKeys }: { error: string; expandedKeys: string[]; isLoading: boolean; onPreviewPath: (path: string) => void; onSelectPaths: (path: string, paths?: string[]) => void; root: OpenClawWorkspaceNode | null; selectedKeys: string[] }) {
  if (isLoading) return <TreeSkeleton />
  if (error) return <div className="rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">{error}</div>
  if (!root) return <EmptyState icon="lucide:folder-search" text="暂无可显示的工作区文件。" />

  return (
    <FileTree
      aria-label="工作区文件树"
      className="w-full"
      defaultExpandedKeys={expandedKeys}
      selectedKeys={selectedKeys}
      selectionMode="multiple"
      showGuideLines="hover"
      onAction={(key) => onPreviewPath(String(key))}
      onSelectionChange={(keys) => {
        const paths = Array.from(keys).map((key) => String(key))
        const path = paths.at(-1)
        if (path) onSelectPaths(path, paths)
      }}
    >
      {renderWorkspaceTreeItem(root)}
    </FileTree>
  )
}

function renderWorkspaceTreeItem(node: OpenClawWorkspaceNode) {
  return (
    <FileTree.Item
      key={node.relativePath}
      icon={<Icon icon={workspaceNodeIcon(node)} className={`size-4 ${workspaceNodeIconClass(node)}`} />}
      id={node.relativePath}
      textValue={node.relativePath}
      title={node.name}
    >
      {(node.children ?? []).map((child) => renderWorkspaceTreeItem(child))}
    </FileTree.Item>
  )
}

function WorkspaceBreadcrumbs({ onSelectPath, selectedPath }: { onSelectPath: (path: string) => void; selectedPath: string }) {
  const crumbs = workspaceBreadcrumbItems(selectedPath)
  return (
    <Breadcrumbs className="max-w-full overflow-x-auto">
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1
        return (
          <Breadcrumbs.Item key={crumb.path} href={isLast ? undefined : '#'} className="no-underline" onPress={isLast ? undefined : () => onSelectPath(crumb.path)}>
            {crumb.label}
          </Breadcrumbs.Item>
        )
      })}
    </Breadcrumbs>
  )
}

function WorkspaceUploadPanel({ onUploadFiles, targetDirectory }: { onUploadFiles: (directoryPath: string, files: File[]) => void; targetDirectory: string }) {
  const [files, setFiles] = useState<UploadFileItem[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())

  useEffect(() => {
    files.forEach((file) => {
      if (file.status === 'uploading' && !timersRef.current.has(file.id)) {
        const fileId = file.id
        const timer = setInterval(() => {
          setFiles((prev) => prev.map((item) => {
            if (item.id !== fileId || item.status !== 'uploading') return item
            const next = Math.min(item.progress + Math.floor(Math.random() * 12) + 8, 95)
            return { ...item, progress: next }
          }))
        }, 350)

        timersRef.current.set(fileId, timer)
      }
    })
  }, [files])

  useEffect(() => {
    const ref = timersRef.current
    return () => {
      ref.forEach((timer) => clearInterval(timer))
      ref.clear()
    }
  }, [])

  const finishFiles = useCallback((ids: string[], status: UploadFileStatus) => {
    ids.forEach((id) => {
      const timer = timersRef.current.get(id)
      if (timer) clearInterval(timer)
      timersRef.current.delete(id)
    })
    setFiles((prev) => prev.map((file) => ids.includes(file.id) ? { ...file, progress: status === 'complete' ? 100 : file.progress, status } : file))
  }, [])

  const handleSelect = useCallback(async (fileList: FileList) => {
    const selectedFiles = Array.from(fileList)
    if (!selectedFiles.length) return
    const newFiles: UploadFileItem[] = selectedFiles.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      progress: 0,
      size: file.size,
      status: 'uploading',
    }))
    const ids = newFiles.map((file) => file.id)

    setFiles((prev) => [...newFiles, ...prev])
    try {
      await onUploadFiles(targetDirectory, selectedFiles)
      finishFiles(ids, 'complete')
    } catch {
      finishFiles(ids, 'failed')
    }
  }, [finishFiles, onUploadFiles, targetDirectory])

  const handleRemove = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (timer) clearInterval(timer)
    timersRef.current.delete(id)
    setFiles((prev) => prev.filter((file) => file.id !== id))
  }, [])

  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto rounded-2xl border border-divider bg-surface p-6">
      <DropZone className="w-full max-w-xl">
        <DropZone.Area>
          <DropZone.Icon />
          <DropZone.Label>上传到当前目录</DropZone.Label>
          <DropZone.Description>{targetDirectory === '.' ? 'workspace 根目录' : targetDirectory} · 单文件最大 {formatBytes(workspaceUploadMaxBytes)}</DropZone.Description>
          <DropZone.Trigger>选择文件</DropZone.Trigger>
        </DropZone.Area>
        <DropZone.Input multiple onSelect={handleSelect} />

        {files.length > 0 ? (
          <DropZone.FileList>
            {files.map((file) => {
              const ext = getExtension(file.name).toUpperCase()
              return (
                <DropZone.FileItem key={file.id} status={file.status}>
                  <DropZone.FileFormatIcon color={getFormatColor(ext.toLowerCase())} format={ext} />
                  <DropZone.FileInfo>
                    <DropZone.FileName>{file.name}</DropZone.FileName>
                    <DropZone.FileMeta>
                      {formatBytes(file.size)}
                      {file.status === 'uploading' ? ` | ${file.progress}%` : null}
                      {file.status === 'complete' ? ' | 100%' : null}
                      {file.status === 'failed' ? ' | 上传失败' : null}
                    </DropZone.FileMeta>
                    {file.status === 'uploading' ? (
                      <DropZone.FileProgress value={file.progress}>
                        <DropZone.FileProgressTrack>
                          <DropZone.FileProgressFill />
                        </DropZone.FileProgressTrack>
                      </DropZone.FileProgress>
                    ) : null}
                  </DropZone.FileInfo>
                  <DropZone.FileRemoveTrigger aria-label={`Remove ${file.name}`} onPress={() => handleRemove(file.id)} />
                </DropZone.FileItem>
              )
            })}
          </DropZone.FileList>
        ) : null}
      </DropZone>
    </div>
  )
}

function DataUrlPreview({ data }: { data: OpenClawWorkspaceFileResponse }) {
  const mime = data.file.mime ?? ''
  if (mime.startsWith('image/')) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center overflow-auto rounded-2xl border border-divider bg-surface-secondary/50 p-4">
        <img src={data.dataUrl} alt={data.file.name} className="max-h-full max-w-full rounded-xl object-contain" />
      </div>
    )
  }
  if (mime === 'application/pdf') {
    return (
      <div className="h-full min-h-0 overflow-hidden rounded-2xl border border-divider bg-surface-secondary/50">
        <object data={data.dataUrl} type="application/pdf" className="h-full w-full">
          <FilePreviewFallback data={data} label="浏览器无法直接预览 PDF" />
        </object>
      </div>
    )
  }
  if (mime.startsWith('video/')) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center overflow-auto rounded-2xl border border-divider bg-black p-4">
        <video src={data.dataUrl} controls className="max-h-full max-w-full rounded-xl" />
      </div>
    )
  }
  if (mime.startsWith('audio/')) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center rounded-2xl border border-divider bg-surface-secondary/50 px-6 text-center">
        <Icon icon="lucide:file-audio" className="size-12 text-primary" />
        <p className="mt-3 font-semibold text-foreground">{data.file.name}</p>
        <p className="mt-1 text-sm text-muted">{formatBytes(data.file.size || 0)}</p>
        <audio src={data.dataUrl} controls className="mt-6 w-full max-w-xl" />
      </div>
    )
  }
  if (isOfficeMime(mime)) {
    return <FilePreviewFallback data={data} label="Office 文件已加载，浏览器可能无法直接预览" />
  }
  return <FilePreviewFallback data={data} label="当前文件类型不支持内嵌预览" />
}

function FilePreviewFallback({ data, label }: { data: OpenClawWorkspaceFileResponse; label: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center rounded-2xl bg-surface-secondary/50 px-6 text-center">
      <Icon icon={officePreviewIcon(data.file.mime ?? '')} className="size-10 text-muted" />
      <p className="mt-3 font-semibold text-foreground">{label}</p>
      <p className="mt-2 max-w-md truncate text-sm text-muted">{data.file.name}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Chip variant="soft">{formatBytes(data.file.size || 0)}</Chip>
        {data.file.mime ? <Chip variant="soft">{data.file.mime}</Chip> : null}
      </div>
      {data.dataUrl ? (
        <Button className="mt-5" variant="secondary" onPress={() => openDataUrl(data.dataUrl!, data.file.name)}>
          打开预览
        </Button>
      ) : null}
    </div>
  )
}

function FilePreview({ content, data, editorTheme, error, isLoading, onContentChange, onSelectPath, onUploadFiles, selectedNode }: { content: string; data: OpenClawWorkspaceFileResponse | null; editorTheme: 'vs' | 'vs-dark'; error: string; isLoading: boolean; onContentChange: (content: string) => void; onSelectPath: (path: string) => void; onUploadFiles: (directoryPath: string, files: File[]) => void; selectedNode: OpenClawWorkspaceNode | null }) {
  if (isLoading) return <Skeleton className="h-full min-h-0 rounded-2xl" />
  if (error) return <div className="rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">{error}</div>
  if (!selectedNode) return <EmptyState icon="lucide:mouse-pointer-click" text="选择左侧文件后在这里预览。" />
  if (selectedNode.type !== 'file') return <DirectoryDetails canUpload={selectedNode.relativePath !== '.'} node={selectedNode} onSelectPath={onSelectPath} onUploadFiles={onUploadFiles} />
  if (!data) return <EmptyState icon="lucide:file-search" text="正在等待文件内容。" />
  if (data.dataUrl) {
    return <DataUrlPreview data={data} />
  }
  if (!data.file.readable) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center rounded-2xl bg-surface-secondary/50 px-6 text-center">
        <Icon icon={data.file.binary ? 'lucide:file-archive' : 'lucide:shield-alert'} className="size-10 text-muted" />
        <p className="mt-3 font-semibold text-foreground">无法预览此文件</p>
        <p className="mt-2 max-w-md text-sm text-muted">{data.file.redactedReason || '该文件不适合在浏览器中直接预览。'}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Chip variant="soft">{formatBytes(data.file.size || 0)}</Chip>
          {data.file.language ? <Chip variant="soft">{data.file.language}</Chip> : null}
          {data.file.mime ? <Chip variant="soft">{data.file.mime}</Chip> : null}
        </div>
      </div>
    )
  }
  return (
    <div className="h-full min-h-0 overflow-hidden rounded-2xl border border-divider">
      <Editor
        height="100%"
        language={data.file.language || 'plaintext'}
        theme={editorTheme}
        value={content}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineHeight: 22,
          padding: { top: 16, bottom: 16 },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
        }}
        onChange={(value) => onContentChange(value ?? '')}
      />
    </div>
  )
}

function DirectoryDetails({ canUpload, node, onSelectPath, onUploadFiles }: { canUpload: boolean; node: OpenClawWorkspaceNode; onSelectPath: (path: string) => void; onUploadFiles: (directoryPath: string, files: File[]) => void }) {
  const [isDragOver, setIsDragOver] = useState(false)
  const children = node.children ?? []

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!canUpload) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
  }, [canUpload])

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!canUpload) return
    event.preventDefault()
    setIsDragOver(false)
    const files = Array.from(event.dataTransfer.files).filter((file) => file.size >= 0)
    if (files.length) onUploadFiles(node.relativePath, files)
  }, [canUpload, node.relativePath, onUploadFiles])

  return (
    <div
      className={`relative h-full min-h-0 overflow-y-auto rounded-2xl border border-dashed p-3 transition-colors ${isDragOver ? 'border-primary bg-primary/5' : 'border-transparent'}`}
      onDragEnter={canUpload ? handleDragOver : undefined}
      onDragLeave={canUpload ? () => setIsDragOver(false) : undefined}
      onDragOver={canUpload ? handleDragOver : undefined}
      onDrop={canUpload ? handleDrop : undefined}
    >
      <div className="grid content-start gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {children.map((child) => (
          <button
            key={child.relativePath}
            type="button"
            className="group flex min-w-0 items-center gap-3 rounded-2xl border border-divider bg-surface px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            onClick={() => onSelectPath(child.relativePath)}
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background-tertiary">
              <Icon icon={workspaceNodeIcon(child)} className={`size-5 ${workspaceNodeIconClass(child)}`} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground group-hover:text-primary">{child.name}</p>
              <p className="mt-1 truncate text-xs text-muted">
                {child.type === 'directory' ? `${child.childCount ?? child.children?.length ?? 0} 项` : formatBytes(child.size || 0)}
              </p>
            </div>
          </button>
        ))}
      </div>
      {children.length === 0 ? (
        <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center">
          <Icon icon={canUpload ? 'lucide:upload-cloud' : 'lucide:folder-open'} className="size-9 text-muted" />
          <p className="mt-3 text-sm text-muted">{canUpload ? '拖拽文件到这里上传。' : '工作区根目录不支持直接上传，请先进入子文件夹。'}</p>
        </div>
      ) : null}
      {isDragOver ? (
        <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-2xl bg-primary/10 text-sm font-semibold text-primary ring-2 ring-primary/30">
          松开以上传到当前目录
        </div>
      ) : null}
    </div>
  )
}
function CreateEntryModal({ error, isOpen, isSaving, name, onNameChange, onOpenChange, onSubmit, parent, type }: { error: string; isOpen: boolean; isSaving: boolean; name: string; onNameChange: (value: string) => void; onOpenChange: (open: boolean) => void; onSubmit: () => void; parent: string; type: WorkspaceEntryType }) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
      <Modal.Container size="md">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-accent/10 text-accent">
              <Icon icon={type === 'directory' ? 'lucide:folder-plus' : 'lucide:file-plus-2'} className="size-5" />
            </Modal.Icon>
            <div className="min-w-0">
              <Modal.Heading>{type === 'directory' ? '新建文件夹' : '新建文件'}</Modal.Heading>
              <p className="mt-1 text-sm text-muted">创建位置：{parent}</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            {error ? <div className="mb-3 rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">{error}</div> : null}
            <div className="p-1">
              <TextField fullWidth name="workspace-entry-name">
                {/* <Label>{type === 'directory' ? '文件夹名称' : '文件名称'}</Label> */}
                <InputGroup fullWidth variant="secondary">
                  <InputGroup.Prefix>
                    <Icon icon={type === 'directory' ? 'lucide:folder' : 'lucide:file'} className="size-4 text-muted" />
                  </InputGroup.Prefix>
                  <InputGroup.Input autoFocus placeholder={type === 'directory' ? 'notes' : 'notes.md'} value={name} onChange={(event) => onNameChange(event.target.value)} />
                </InputGroup>
              </TextField>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" onPress={() => onOpenChange(false)} isDisabled={isSaving}>取消</Button>
            <Button variant="primary" onPress={onSubmit} isPending={isSaving}>创建</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function DeleteEntryModal({ isDeleting, isOpen, node, onOpenChange, onSubmit }: { isDeleting: boolean; isOpen: boolean; node: OpenClawWorkspaceNode | null; onOpenChange: (open: boolean) => void; onSubmit: () => void }) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
      <Modal.Container size="md">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-danger/10 text-danger">
              <Icon icon="lucide:trash-2" className="size-5" />
            </Modal.Icon>
            <div className="min-w-0">
              <Modal.Heading>删除工作区项目</Modal.Heading>
              <p className="mt-1 text-sm text-muted">此操作不可撤销。</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            <div className="rounded-2xl bg-surface-secondary/50 px-4 py-3">
              <p className="text-sm font-semibold text-foreground">{node?.name || '未选择'}</p>
              <p className="mt-1 break-all text-xs text-muted">{node?.relativePath}</p>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" onPress={() => onOpenChange(false)} isDisabled={isDeleting}>取消</Button>
            <Button variant="danger-soft" onPress={onSubmit} isPending={isDeleting}>删除</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function BulkDeleteEntriesModal({ isDeleting, isOpen, nodes, onOpenChange, onSubmit, totalCount }: { isDeleting: boolean; isOpen: boolean; nodes: OpenClawWorkspaceNode[]; onOpenChange: (open: boolean) => void; onSubmit: () => void; totalCount: number }) {
  const skippedCount = totalCount - nodes.length
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
      <Modal.Container size="md">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-danger/10 text-danger">
              <Icon icon="lucide:trash-2" className="size-5" />
            </Modal.Icon>
            <div className="min-w-0">
              <Modal.Heading>批量删除工作区项目</Modal.Heading>
              <p className="mt-1 text-sm text-muted">将删除 {nodes.length} 项，此操作不可撤销。</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            {skippedCount > 0 ? <div className="mb-3 rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">已跳过 {skippedCount} 个根目录或核心文件。</div> : null}
            <div className="max-h-64 space-y-2 overflow-y-auto rounded-2xl bg-surface-secondary/50 p-3">
              {nodes.map((node) => <p key={node.relativePath} className="truncate text-sm text-foreground">{node.relativePath}</p>)}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" onPress={() => onOpenChange(false)} isDisabled={isDeleting}>取消</Button>
            <Button variant="danger-soft" onPress={onSubmit} isPending={isDeleting} isDisabled={nodes.length === 0}>删除 {nodes.length} 项</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function MoveEntriesModal({ error, isMoving, isOpen, nodes, onOpenChange, onSubmit, onTargetChange, target, totalCount }: { error: string; isMoving: boolean; isOpen: boolean; nodes: OpenClawWorkspaceNode[]; onOpenChange: (open: boolean) => void; onSubmit: () => void; onTargetChange: (value: string) => void; target: string; totalCount: number }) {
  const skippedCount = totalCount - nodes.length
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
      <Modal.Container size="md">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-primary/10 text-primary">
              <Icon icon="lucide:folder-input" className="size-5" />
            </Modal.Icon>
            <div className="min-w-0">
              <Modal.Heading>移动到目标文件夹</Modal.Heading>
              <p className="mt-1 text-sm text-muted">将移动 {nodes.length} 项到指定文件夹。</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            {error ? <div className="mb-3 rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">{error}</div> : null}
            {skippedCount > 0 ? <div className="mb-3 rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">已跳过 {skippedCount} 个根目录或核心文件。</div> : null}
            <TextField className={`p-1 ${error ? 'mb-3' : ''}`} fullWidth name="workspace-move-target">
              <InputGroup fullWidth variant="secondary">
                <InputGroup.Prefix>
                  <Icon icon="lucide:folder" className="size-4 text-muted" />
                </InputGroup.Prefix>
                <InputGroup.Input placeholder="目标文件夹路径，例如 archive 或 ." value={target} onChange={(event) => onTargetChange(event.target.value)} />
              </InputGroup>
            </TextField>
            <div className="mt-3 max-h-48 space-y-2 overflow-y-auto rounded-2xl bg-surface-secondary/50 p-3">
              {nodes.map((node) => <p key={node.relativePath} className="truncate text-sm text-foreground">{node.relativePath}</p>)}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" onPress={() => onOpenChange(false)} isDisabled={isMoving}>取消</Button>
            <Button variant="primary" onPress={onSubmit} isPending={isMoving} isDisabled={nodes.length === 0}>移动</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function TreeSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 12 }).map((_, index) => <Skeleton key={index} className="h-11 rounded-xl" />)}
    </div>
  )
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center rounded-2xl bg-surface-secondary/50 px-6 text-center">
      <Icon icon={icon} className="size-9 text-muted" />
      <p className="mt-3 text-sm text-muted">{text}</p>
    </div>
  )
}

type FlattenedWorkspaceNode = {
  depth: number
  node: OpenClawWorkspaceNode
}

function flattenWorkspaceNodes(root?: OpenClawWorkspaceNode): FlattenedWorkspaceNode[] {
  if (!root) return []
  const nodes: FlattenedWorkspaceNode[] = []
  const visit = (node: OpenClawWorkspaceNode, depth: number) => {
    nodes.push({ depth, node })
    for (const child of node.children ?? []) visit(child, depth + 1)
  }
  visit(root, 0)
  return nodes
}

function resolveWorkspaceSelectionChange(paths: string[], previousPaths: string[], flattenedNodes: FlattenedWorkspaceNode[]) {
  const selected = new Set(paths)
  const previous = new Set(previousPaths)
  const byPath = new Map(flattenedNodes.map((item) => [item.node.relativePath, item.node]))
  const collect = (node: OpenClawWorkspaceNode, target: Set<string>) => {
    target.add(node.relativePath)
    for (const child of node.children ?? []) collect(child, target)
  }
  const remove = (node: OpenClawWorkspaceNode, target: Set<string>) => {
    target.delete(node.relativePath)
    for (const child of node.children ?? []) remove(child, target)
  }

  for (const path of previousPaths) {
    if (selected.has(path)) continue
    const node = byPath.get(path)
    if (node?.type === 'directory') remove(node, selected)
  }

  for (const path of paths) {
    if (previous.has(path)) continue
    const node = byPath.get(path)
    if (node?.type === 'directory') collect(node, selected)
  }

  return flattenedNodes.map((item) => item.node.relativePath).filter((path) => selected.has(path))
}

function filterWorkspaceTree(root: OpenClawWorkspaceNode | undefined, query: string): OpenClawWorkspaceNode | null {
  if (!root) return null
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return root
  const filterNode = (node: OpenClawWorkspaceNode): OpenClawWorkspaceNode | null => {
    const filteredChildren = (node.children ?? []).map(filterNode).filter((child): child is OpenClawWorkspaceNode => Boolean(child))
    const matches = node.name.toLowerCase().includes(normalizedQuery) || node.relativePath.toLowerCase().includes(normalizedQuery)
    if (matches || filteredChildren.length) return { ...node, children: filteredChildren }
    return null
  }
  return filterNode(root)
}

function workspaceBreadcrumbItems(path: string) {
  const cleanPath = path && path !== '.' ? path : '.'
  if (cleanPath === '.') return [{ label: 'workspace', path: '.' }]
  const parts = cleanPath.split('/').filter(Boolean)
  const crumbs = [{ label: 'workspace', path: '.' }]
  let current = ''
  for (const part of parts) {
    current = current ? `${current}/${part}` : part
    crumbs.push({ label: part, path: current })
  }
  return crumbs
}

function currentDirectoryForSelection(node: OpenClawWorkspaceNode | null) {
  if (!node || node.relativePath === '.') return '.'
  if (node.type === 'directory') return node.relativePath
  return parentWorkspacePath(node.relativePath)
}

function parentWorkspacePath(path: string) {
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return parts.length ? parts.join('/') : '.'
}

function joinWorkspacePath(parent: string, name: string) {
  return !parent || parent === '.' ? name : `${parent}/${name}`
}

function validateClientWorkspaceName(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return '名称不能为空'
  const parts = trimmed.split('/').filter(Boolean)
  if (!parts.length) return '名称不能为空'
  for (const part of parts) {
    if (part === '.' || part === '..') return '名称不能包含无效路径片段'
    if (part.startsWith('.')) return '不支持隐藏文件或隐藏文件夹'
  }
  return ''
}

function isProtectedWorkspaceNode(node: OpenClawWorkspaceNode) {
  return node.type === 'file' && protectedWorkspaceFiles.has(node.name)
}

function agentLabel(agent: OpenClawAgentSummary) {
  return agent.name || agent.identity.name || agent.id
}

function workspaceNodeIcon(node: OpenClawWorkspaceNode) {
  if (node.symlink) return 'lucide:link'
  if (node.type === 'directory') return 'lucide:folder'
  if (node.binary) return 'lucide:file-archive'
  switch (node.language) {
    case 'markdown':
      return 'lucide:file-text'
    case 'json':
      return 'lucide:braces'
    case 'typescript':
    case 'javascript':
    case 'go':
    case 'python':
    case 'rust':
      return 'lucide:file-code-2'
    default:
      return 'lucide:file'
  }
}

function workspaceNodeIconClass(node: OpenClawWorkspaceNode) {
  if (node.redactedReason) return 'text-warning'
  if (node.type === 'directory') return 'text-primary'
  return 'text-muted'
}

function openDataUrl(dataUrl: string, fileName: string) {
  const win = window.open('', '_blank', 'noopener,noreferrer')
  if (!win) return
  win.document.title = fileName
  win.document.body.style.margin = '0'
  win.document.body.innerHTML = `<iframe title="${fileName.replaceAll('"', '&quot;')}" src="${dataUrl}" style="width:100vw;height:100vh;border:0"></iframe>`
}

function isOfficeMime(mime: string) {
  return mime.includes('officedocument') || mime === 'application/msword' || mime === 'application/vnd.ms-excel' || mime === 'application/vnd.ms-powerpoint'
}

function officePreviewIcon(mime: string) {
  if (mime.includes('word')) return 'lucide:file-text'
  if (mime.includes('excel') || mime.includes('spreadsheet')) return 'lucide:table'
  if (mime.includes('powerpoint') || mime.includes('presentation')) return 'lucide:presentation'
  if (mime === 'application/pdf') return 'lucide:file-text'
  return 'lucide:file'
}

function getExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1) : ''
}

type FileFormatColor = 'blue' | 'gray' | 'green' | 'orange' | 'purple' | 'red'

function getFormatColor(ext: string): FileFormatColor {
  const map: Record<string, FileFormatColor> = {
    csv: 'green',
    doc: 'blue',
    docx: 'blue',
    fig: 'purple',
    jpeg: 'blue',
    jpg: 'blue',
    json: 'orange',
    mp4: 'purple',
    pdf: 'red',
    png: 'green',
    svg: 'green',
    txt: 'gray',
    xlsx: 'green',
    zip: 'orange',
  }

  return map[ext.toLowerCase()] ?? 'gray'
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      resolve(result.includes(',') ? result.split(',', 2)[1] : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

function workspaceTotalSize(node?: OpenClawWorkspaceNode | null): number {
  if (!node) return 0
  return (node.size ?? 0) + (node.children ?? []).reduce((total, child) => total + workspaceTotalSize(child), 0)
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

export default OpenClawWorkspacesPage

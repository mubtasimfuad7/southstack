// ============================================================
// CORE SERVICES: EditorService implementation
// Tracks tabs, dirty state. Auto-saves to IDB.
// "Sync" button in UI triggers FileSystemService.syncToLocalFS()
// ============================================================

import type { IEditorService, EditorTab } from '@/core/interfaces/IEditorService'
import { fileSystemService } from './FileSystemService'
import { getLanguageFromPath } from '@/core/utils/language'

type TabsListener = (tabs: EditorTab[]) => void
type ActiveListener = (tab: EditorTab | null) => void
type DraftResolutionListener = (tabId: string, status: 'accepted' | 'rejected') => void

export class EditorService implements IEditorService {
  private tabs: Map<string, EditorTab> = new Map()
  private activeTabId: string | null = null
  private tabsListeners: Set<TabsListener> = new Set()
  private activeListeners: Set<ActiveListener> = new Set()
  private draftListeners: Set<DraftResolutionListener> = new Set()
  private autoSaveTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()

  // ──────────────────────────────────────────────────────────
  // Tab management
  // ──────────────────────────────────────────────────────────

  async openTab(path: string, content: string): Promise<EditorTab> {
    const existing = this.findTabByPath(path)
    if (existing) {
      this.switchTab(existing.id)
      return existing
    }

    const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const label = path.split('/').pop() ?? path
    const tab: EditorTab = {
      id,
      path,
      label,
      content,
      isDirty: false,
      language: getLanguageFromPath(path),
    }

    this.tabs.set(id, tab)
    this.activeTabId = id
    this._emitTabs()
    this._emitActive()
    return tab
  }

  closeTab(tabId: string): void {
    this.tabs.delete(tabId)
    if (this.activeTabId === tabId) {
      const remaining = [...this.tabs.keys()]
      this.activeTabId = remaining[remaining.length - 1] ?? null
    }
    this._emitTabs()
    this._emitActive()
  }

  closeTabByPath(path: string): void {
    const tab = this.findTabByPath(path)
    if (tab) {
      this.closeTab(tab.id)
    }
  }

  switchTab(tabId: string): void {
    if (this.tabs.has(tabId)) {
      this.activeTabId = tabId
      this._emitActive()
    }
  }

  getActiveTab(): EditorTab | null {
    return this.activeTabId ? (this.tabs.get(this.activeTabId) ?? null) : null
  }

  getAllTabs(): EditorTab[] {
    return [...this.tabs.values()]
  }

  // ──────────────────────────────────────────────────────────
  // Content management
  // ──────────────────────────────────────────────────────────

  updateContent(tabId: string, content: string): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return

    tab.content = content
    tab.isDirty = true
    this._emitTabs()

    // Debounced auto-save to IDB
    if (this.autoSaveTimers.has(tabId)) {
      clearTimeout(this.autoSaveTimers.get(tabId)!)
    }
    this.autoSaveTimers.set(
      tabId,
      setTimeout(() => this.saveTab(tabId), 800)
    )
  }

  updateContentFromExternal(path: string, content: string, force = false): void {
    const tab = this.findTabByPath(path)
    if (!tab) return
    // Only update if no active local edits or drafts, OR if forced (autonomous mode)
    if (force || (!tab.isDirty && !tab.draftContent)) {
      tab.content = content
      tab.isDirty = false
      tab.draftContent = undefined // Clear any existing draft if forced
      this._emitTabs()
      this._emitActive()
    }
  }

  async saveTab(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    await fileSystemService.writeFile(tab.path, tab.content)
    tab.isDirty = false
    this._emitTabs()
  }

  // ──────────────────────────────────────────────────────────
  // Draft Management (Antigravity-style)
  // ──────────────────────────────────────────────────────────

  async proposeChange(path: string, content: string): Promise<void> {
    let tab = this.findTabByPath(path)
    if (!tab) {
      // If file not open, read it first to get "original"
      const original = await fileSystemService.readFile(path).catch(() => '')
      tab = await this.openTab(path, original)
    }

    // Set the draft content
    tab.draftContent = content
    
    // Switch to this tab so the user sees the diff
    this.switchTab(tab.id)
    this._emitTabs()
    
    // OPTIONAL: Write to WebContainer immediately so the user can 'npm test' or 'gcc' 
    // the AI's proposal before accepting it. 
    const { runtimeService } = await import('./RuntimeService')
    await runtimeService.writeFile(path, content)
  }

  async acceptDraft(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId)
    if (!tab || !tab.draftContent) return

    const newContent = tab.draftContent
    tab.content = newContent
    tab.draftContent = undefined
    tab.isDirty = false // We consider 'Accept' as an implicit save
    
    await fileSystemService.writeFile(tab.path, newContent)
    
    this._emitTabs()
    this._emitActive()
    this._emitDraftResolution(tabId, 'accepted')
  }

  async rejectDraft(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId)
    if (!tab || !tab.draftContent) return

    tab.draftContent = undefined
    
    // ROLLBACK: Re-write the original content back to the WebContainer
    const { runtimeService } = await import('./RuntimeService')
    await runtimeService.writeFile(tab.path, tab.content)

    this._emitTabs()
    this._emitActive()
    this._emitDraftResolution(tabId, 'rejected')
  }

  async saveAllTabs(): Promise<void> {
    for (const tabId of this.tabs.keys()) {
      await this.saveTab(tabId)
    }
  }

  markClean(tabId: string): void {
    const tab = this.tabs.get(tabId)
    if (tab) {
      tab.isDirty = false
      this._emitTabs()
    }
  }

  isDirty(tabId: string): boolean {
    return this.tabs.get(tabId)?.isDirty ?? false
  }

  findTabByPath(path: string): EditorTab | undefined {
    return [...this.tabs.values()].find((t) => t.path === path)
  }

  // ──────────────────────────────────────────────────────────
  // Subscriptions
  // ──────────────────────────────────────────────────────────

  onTabsChange(cb: TabsListener): () => void {
    this.tabsListeners.add(cb)
    return () => this.tabsListeners.delete(cb)
  }

  onActiveTabChange(cb: ActiveListener): () => void {
    this.activeListeners.add(cb)
    return () => this.activeListeners.delete(cb)
  }

  onDraftResolution(cb: DraftResolutionListener): () => void {
    this.draftListeners.add(cb)
    return () => this.draftListeners.delete(cb)
  }

  private _emitTabs() {
    const tabs = this.getAllTabs()
    this.tabsListeners.forEach((cb) => cb(tabs))
  }

  private _emitActive() {
    const active = this.getActiveTab()
    this.activeListeners.forEach((cb) => cb(active))
  }

  private _emitDraftResolution(tabId: string, status: 'accepted' | 'rejected') {
    this.draftListeners.forEach((cb) => cb(tabId, status))
  }
}

export const editorService = new EditorService()

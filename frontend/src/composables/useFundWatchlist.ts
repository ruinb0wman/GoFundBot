// @ts-nocheck
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useWatchlistStore } from '../stores/watchlistStore'
import { useAdaptiveRefresh } from './useAdaptiveRefresh'

export function useFundWatchlist(
  props: { compareMode: boolean; compareFunds: any[]; showCompareToggle: boolean; addToRealtimeMode: boolean },
  emit: (event: string, ...args: any[]) => void
) {
  const watchlist = ref([])
  const groups = ref([])
  const loading = ref(false)
  const editMode = ref(false)
  const selectedFunds = ref([])
  const draggingIndex = ref(null)
  const dragOverIndex = ref(null)
  // 拖动过程中鼠标停留过的分组（null = 未分组）；dragstart 时先置为来源分组，
  // 这样「拖到分组外/分组之间的空白处松手」也能落到最后经过的分组，而不是被当成组内排序。
  const dragOverGroupId = ref(null)
  const expandedGroups = ref([null])
  const isInitialLoad = ref(true)

  const showGroupModal = ref(false)
  const editingGroup = ref(null)
  const groupName = ref('')
  const groupNameInput = ref(null)
  const alertFundCode = ref('')

  const adaptiveRefresh = useAdaptiveRefresh({
    fetcher: async () => {
      if (watchlist.value.length === 0) return false
      isRefreshingEstimates.value = true
      try {
        await watchlistStore.refreshEstimates()
        watchlist.value = Array.isArray(watchlistStore.funds) ? watchlistStore.funds : []
        groups.value = Array.isArray(watchlistStore.groups) ? watchlistStore.groups : []
        const times = watchlistStore.funds.map(f => f.estimate_time).filter(Boolean).sort() as string[]
        lastEstimateUpdate.value = times.length > 0 ? times[times.length - 1] : new Date().toLocaleTimeString()
        return true
      } catch (error) {
        console.error('刷新估值失败:', error)
        return false
      } finally {
        isRefreshingEstimates.value = false
      }
    },
  })

  const lastEstimateUpdate = ref(null)
  const isRefreshingEstimates = ref(false)

  const _compareDateStr = (val) => {
    if (!val) return ''
    const s = String(val)
    const m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
    if (m) {
      return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
    }
    return s
  }

  const _watchlist = computed(() => Array.isArray(watchlist.value) ? watchlist.value : [])

  const totalCount = computed(() => _watchlist.value.length)

  const ungroupedFunds = computed(() =>
    _watchlist.value.filter(f => !f.group_id)
  )

  const getGroupFunds = (groupId) => {
    return _watchlist.value.filter(f => f.group_id === groupId)
  }

  const isGroupExpanded = (groupId) => {
    return expandedGroups.value.includes(groupId)
  }

  const watchlistStore = useWatchlistStore()

  const loadWatchlist = async () => {
    loading.value = true
    try {
      await watchlistStore.fetch(true)
      if (watchlistStore.funds.length > 0) {
        await watchlistStore.refreshEstimates()
      }
      watchlist.value = Array.isArray(watchlistStore.funds) ? watchlistStore.funds : []
      groups.value = Array.isArray(watchlistStore.groups) ? watchlistStore.groups : []
      if (isInitialLoad.value) {
        expandedGroups.value = [null, ...groups.value.map(g => g.id)]
        isInitialLoad.value = false
      } else {
        const validGroupIds = new Set([null, ...groups.value.map(g => g.id)])
        expandedGroups.value = expandedGroups.value.filter(id => validGroupIds.has(id))
      }
    } catch (error) {
      console.error('加载自选列表失败:', error)
    } finally {
      loading.value = false
    }
  }

  const refreshWatchlist = () => loadWatchlist()

  const refreshEstimates = async () => {
    adaptiveRefresh.refresh()
  }

  const startEstimateRefreshTimer = () => {
    if (watchlist.value.length > 0) adaptiveRefresh.start()
  }

  const stopEstimateRefreshTimer = () => {
    adaptiveRefresh.stop()
  }

  const toggleGroup = (groupId) => {
    const index = expandedGroups.value.indexOf(groupId)
    if (index > -1) {
      expandedGroups.value.splice(index, 1)
    } else {
      expandedGroups.value.push(groupId)
    }
  }

  const enterEditMode = () => {
    editMode.value = true
    selectedFunds.value = []
  }

  const exitEditMode = () => {
    editMode.value = false
    selectedFunds.value = []
  }

  const toggleSelect = (fundCode) => {
    const index = selectedFunds.value.indexOf(fundCode)
    if (index > -1) {
      selectedFunds.value.splice(index, 1)
    } else {
      selectedFunds.value.push(fundCode)
    }
  }

  const batchDelete = async () => {
    if (selectedFunds.value.length === 0) return
    if (!confirm(`确定删除选中的 ${selectedFunds.value.length} 只基金吗？`)) return
    try {
      await watchlistStore.batchDelete(selectedFunds.value)
      watchlist.value = watchlist.value.filter(
        f => !selectedFunds.value.includes(f.fund_code)
      )
      selectedFunds.value = []
      if (watchlist.value.length === 0) exitEditMode()
    } catch (error) {
      console.error('批量删除失败:', error)
      alert('删除失败，请重试')
    }
  }

  const removeFund = async (fundCode) => {
    if (!confirm('确定移除该基金吗？')) return
    try {
      await watchlistStore.removeFund(fundCode)
      watchlist.value = watchlist.value.filter(f => f.fund_code !== fundCode)
    } catch (error) {
      console.error('移除失败:', error)
    }
  }

  const viewFundDetail = (fundCode) => {
    emit('view-fund', fundCode)
  }

  const openAlertSettings = (fundCode) => {
    alertFundCode.value = fundCode
  }

  const addToCompare = (fund) => {
    emit('add-to-compare', fund)
  }

  const fundsOfGroup = (groupId) =>
    groupId === null ? ungroupedFunds.value : getGroupFunds(groupId)

  const onDragStart = (event, index, groupId) => {
    draggingIndex.value = { index, groupId }
    dragOverGroupId.value = groupId
    dragOverIndex.value = null
    event.dataTransfer.effectAllowed = 'move'
  }

  // 唯一的落点处理：drop 只负责 preventDefault，真正的移动/排序都在 dragend 里做。
  // 这样「落在分组上」「落在分组之间的空白处」走同一条路径，不会出现两套互相打架的逻辑。
  const onDragEnd = async () => {
    const drag = draggingIndex.value
    const over = dragOverIndex.value
    const targetGroupId = dragOverGroupId.value
    draggingIndex.value = null
    dragOverIndex.value = null
    dragOverGroupId.value = null

    if (!drag) return

    if (targetGroupId !== drag.groupId) {
      const fund = fundsOfGroup(drag.groupId)[drag.index]
      if (!fund) return
      try {
        await watchlistStore.moveFundToGroup(fund.fund_code, targetGroupId)
        await loadWatchlist()
      } catch (error) {
        console.error('移动分组失败:', error)
      }
      return
    }

    // 同组内排序：只有真的停在同组某个条目上、且位置变了才动
    if (!over || over.groupId !== drag.groupId || over.index === drag.index) return
    const funds = [...fundsOfGroup(drag.groupId)]
    if (drag.index < 0 || drag.index >= funds.length) return
    const [moved] = funds.splice(drag.index, 1)
    if (!moved) return
    funds.splice(over.index, 0, moved)
    try {
      await watchlistStore.reorder(funds.map(f => f.fund_code), drag.groupId)
      await loadWatchlist()
    } catch (error) {
      console.error('排序失败:', error)
    }
  }

  const onDragOver = (event, index, groupId) => {
    event.preventDefault()
    dragOverIndex.value = { index, groupId }
    dragOverGroupId.value = groupId
  }

  const onDrop = (event) => {
    event.preventDefault()
  }

  const onGroupDragOver = (event, groupId) => {
    event.preventDefault()
    dragOverGroupId.value = groupId
  }

  const onGroupDrop = (event) => {
    event.preventDefault()
  }

  const openAddGroupModal = () => {
    editingGroup.value = null
    groupName.value = ''
    showGroupModal.value = true
    nextTick(() => groupNameInput.value?.focus())
  }

  const openEditGroupModal = (group) => {
    editingGroup.value = group
    groupName.value = group.name
    showGroupModal.value = true
    nextTick(() => groupNameInput.value?.focus())
  }

  const closeGroupModal = () => {
    showGroupModal.value = false
    editingGroup.value = null
    groupName.value = ''
  }

  const saveGroup = async () => {
    const name = groupName.value.trim()
    if (!name) return
    try {
      if (editingGroup.value) {
        await watchlistStore.renameGroup(editingGroup.value.id, name)
      } else {
        const group = await watchlistStore.createGroup(name)
        if (group && group.id) {
          expandedGroups.value.push(group.id)
        }
      }
      closeGroupModal()
      loadWatchlist()
    } catch (error) {
      console.error('保存分组失败:', error)
      alert('操作失败，请重试')
    }
  }

  const deleteGroup = async (group) => {
    if (!confirm(`确定删除分组"${group.name}"吗？\n分组内的基金将移到未分组。`)) return
    try {
      await watchlistStore.deleteGroup(group.id)
      loadWatchlist()
    } catch (error) {
      console.error('删除分组失败:', error)
    }
  }

  onMounted(async () => {
    await loadWatchlist()
    startEstimateRefreshTimer()
    window.addEventListener('watchlist-updated', refreshWatchlist)
  })

  onUnmounted(() => {
    stopEstimateRefreshTimer()
    window.removeEventListener('watchlist-updated', refreshWatchlist)
  })

  return {
    watchlist,
    groups,
    loading,
    editMode,
    selectedFunds,
    draggingIndex,
    expandedGroups,
    totalCount,
    ungroupedFunds,
    getGroupFunds,
    isGroupExpanded,
    showGroupModal,
    editingGroup,
    groupName,
    groupNameInput,
    lastEstimateUpdate,
    isRefreshingEstimates,
    alertFundCode,
    loadWatchlist,
    refreshWatchlist,
    refreshEstimates,
    adaptiveRefresh,
    toggleGroup,
    enterEditMode,
    exitEditMode,
    toggleSelect,
    batchDelete,
    removeFund,
    viewFundDetail,
    addToCompare,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDrop,
    onGroupDragOver,
    onGroupDrop,
    openAlertSettings,
    openAddGroupModal,
    openEditGroupModal,
    closeGroupModal,
    saveGroup,
    deleteGroup
  }
}

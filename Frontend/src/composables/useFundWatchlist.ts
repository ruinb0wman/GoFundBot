// @ts-nocheck
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useWatchlistStore } from '../stores/watchlistStore'
import { translate } from '../locales/index'

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
  const expandedGroups = ref([null])
  const isInitialLoad = ref(true)

  const showGroupModal = ref(false)
  const editingGroup = ref(null)
  const groupName = ref('')
  const groupNameInput = ref(null)
  const alertFundCode = ref('')

  const estimateRefreshTimer = ref(null)
  const lastEstimateUpdate = ref(null)
  const isRefreshingEstimates = ref(false)
  const ESTIMATE_REFRESH_INTERVAL = 3 * 60 * 1000

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
    if (isRefreshingEstimates.value || watchlist.value.length === 0) return
    isRefreshingEstimates.value = true
    try {
      await watchlistStore.refreshEstimates()
      watchlist.value = Array.isArray(watchlistStore.funds) ? watchlistStore.funds : []
      groups.value = Array.isArray(watchlistStore.groups) ? watchlistStore.groups : []
      lastEstimateUpdate.value = new Date().toLocaleTimeString()
    } catch (error) {
      console.error('刷新估值失败:', error)
    } finally {
      isRefreshingEstimates.value = false
    }
  }

  const startEstimateRefreshTimer = () => {
    refreshEstimates()
    estimateRefreshTimer.value = setInterval(() => {
      const now = new Date()
      const day = now.getDay()
      const hour = now.getHours()
      const minute = now.getMinutes()
      const timeInMinutes = hour * 60 + minute
      const isTradeDay = day >= 1 && day <= 5
      const isTradeTime = timeInMinutes >= 9 * 60 + 30 && timeInMinutes <= 15 * 60
      if (isTradeDay && isTradeTime) {
        refreshEstimates()
      }
    }, ESTIMATE_REFRESH_INTERVAL)
  }

  const stopEstimateRefreshTimer = () => {
    if (estimateRefreshTimer.value) {
      clearInterval(estimateRefreshTimer.value)
      estimateRefreshTimer.value = null
    }
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
    if (!confirm(translate('fund.watchlist.confirmDeleteFunds', { count: selectedFunds.value.length }))) return
    try {
      await watchlistStore.batchDelete(selectedFunds.value)
      watchlist.value = watchlist.value.filter(
        f => !selectedFunds.value.includes(f.fund_code)
      )
      selectedFunds.value = []
      if (watchlist.value.length === 0) exitEditMode()
    } catch (error) {
      console.error('批量删除失败:', error)
      alert(translate('fund.watchlist.deleteFailed'))
    }
  }

  const removeFund = async (fundCode) => {
    if (!confirm(translate('fund.watchlist.confirmRemoveFund'))) return
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

  const onDragStart = (event, index, groupId) => {
    draggingIndex.value = { index, groupId }
    event.dataTransfer.effectAllowed = 'move'
  }

  const onDragEnd = async () => {
    if (draggingIndex.value !== null && dragOverIndex.value !== null) {
      const fromGroupId = draggingIndex.value.groupId
      const toGroupId = dragOverIndex.value.groupId
      const fromFunds = fromGroupId === null ? ungroupedFunds.value : getGroupFunds(fromGroupId)
      if (!fromFunds) {
        draggingIndex.value = null
        dragOverIndex.value = null
        return
      }
      if (fromGroupId === toGroupId) {
        if (draggingIndex.value.index === dragOverIndex.value.index) {
          draggingIndex.value = null
          dragOverIndex.value = null
          return
        }
        const funds = [...fromFunds]
        if (draggingIndex.value.index >= 0 && draggingIndex.value.index < funds.length) {
          const [moved] = funds.splice(draggingIndex.value.index, 1)
          if (moved) {
            funds.splice(dragOverIndex.value.index, 0, moved)
            try {
              await watchlistStore.reorder(funds.map(f => f.fund_code), fromGroupId)
              loadWatchlist()
            } catch (error) {
              console.error('排序失败:', error)
            }
          }
        }
      } else {
        const fund = fromFunds[draggingIndex.value.index]
        if (fund) {
          try {
            await watchlistStore.moveFundToGroup(fund.fund_code, toGroupId)
            loadWatchlist()
          } catch (error) {
            console.error('移动失败:', error)
          }
        }
      }
    }
    draggingIndex.value = null
    dragOverIndex.value = null
  }

  const onDragOver = (event, index, groupId) => {
    event.preventDefault()
    dragOverIndex.value = { index, groupId }
  }

  const onDrop = (event, groupId) => {
    event.preventDefault()
  }

  const onGroupDragOver = (event, groupId) => {
    event.preventDefault()
  }

  const onGroupDrop = async (event, groupId) => {
    event.preventDefault()
    if (draggingIndex.value && draggingIndex.value.groupId !== groupId) {
      const fromFunds = draggingIndex.value.groupId === null
        ? ungroupedFunds.value
        : getGroupFunds(draggingIndex.value.groupId)
      const fund = fromFunds[draggingIndex.value.index]
      try {
        await watchlistStore.moveFundToGroup(fund.fund_code, groupId)
        loadWatchlist()
      } catch (error) {
        console.error('移动失败:', error)
      }
    }
    draggingIndex.value = null
    dragOverIndex.value = null
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
      alert(translate('fund.watchlist.operationFailed'))
    }
  }

  const deleteGroup = async (group) => {
    if (!confirm(translate('fund.watchlist.deleteGroupConfirm', { name: group.name }))) return
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

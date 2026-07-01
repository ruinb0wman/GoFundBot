// @ts-nocheck
import { ref, nextTick } from 'vue'
import { translate } from '../locales/index'

export function useFundRealtimeGroups() {
  const portfolioGroups = ref([])
  const fundGroupMap = ref({})
  const showGroupModal = ref(false)
  const editingGroup = ref(null)
  const groupName = ref('')
  const contextMenu = ref({ show: false, x: 0, y: 0, groupId: null })

  const openAddGroupModal = () => {
    editingGroup.value = null
    groupName.value = ''
    showGroupModal.value = true
    nextTick(() => {
      const input = document.querySelector('.group-name-input')
      if (input) input.focus()
    })
  }

  const openEditGroupModal = (group) => {
    editingGroup.value = group
    groupName.value = group.name
    showGroupModal.value = true
    nextTick(() => {
      const input = document.querySelector('.group-name-input')
      if (input) input.focus()
    })
  }

  const closeGroupModal = () => {
    showGroupModal.value = false
    editingGroup.value = null
    groupName.value = ''
  }

  const saveGroup = () => {
    const name = groupName.value.trim()
    if (!name) return
    if (editingGroup.value) {
      const idx = portfolioGroups.value.findIndex(g => g.id === editingGroup.value.id)
      if (idx !== -1) portfolioGroups.value[idx].name = name
    } else {
      portfolioGroups.value.push({
        id: 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        name
      })
    }
    localStorage.setItem('realtime_portfolio_groups', JSON.stringify(portfolioGroups.value))
    closeGroupModal()
  }

  const deleteGroup = (groupId) => {
    const group = portfolioGroups.value.find(g => g.id === groupId)
    if (!group) return
    if (!confirm(translate('fund.realtimeGroups.deleteGroupConfirm', { name: group.name }))) return
    const newMap = { ...fundGroupMap.value }
    Object.keys(newMap).forEach(code => {
      if (newMap[code] === groupId) delete newMap[code]
    })
    fundGroupMap.value = newMap
    localStorage.setItem('realtime_fund_group_map', JSON.stringify(newMap))
    portfolioGroups.value = portfolioGroups.value.filter(g => g.id !== groupId)
    localStorage.setItem('realtime_portfolio_groups', JSON.stringify(portfolioGroups.value))
  }

  const assignFundToGroup = (fundCode, groupId) => {
    const newMap = { ...fundGroupMap.value }
    if (!groupId) {
      delete newMap[fundCode]
    } else {
      newMap[fundCode] = groupId
    }
    fundGroupMap.value = newMap
    localStorage.setItem('realtime_fund_group_map', JSON.stringify(newMap))
  }

  const openGroupContextMenu = (event, groupId) => {
    contextMenu.value = { show: true, x: event.clientX, y: event.clientY, groupId }
  }

  const closeContextMenu = () => {
    contextMenu.value = { ...contextMenu.value, show: false }
  }

  const renameGroupFromMenu = () => {
    const group = portfolioGroups.value.find(g => g.id === contextMenu.value.groupId)
    if (group) openEditGroupModal(group)
    closeContextMenu()
  }

  const deleteGroupFromMenu = () => {
    const groupId = contextMenu.value.groupId
    const group = portfolioGroups.value.find(g => g.id === groupId)
    if (group && confirm(`确定删除分组"${group.name}"吗？分组内的基金将回到默认状态。`)) {
      const newMap = { ...fundGroupMap.value }
      Object.keys(newMap).forEach(code => {
        if (newMap[code] === groupId) delete newMap[code]
      })
      fundGroupMap.value = newMap
      localStorage.setItem('realtime_fund_group_map', JSON.stringify(newMap))
      portfolioGroups.value = portfolioGroups.value.filter(g => g.id !== groupId)
      localStorage.setItem('realtime_portfolio_groups', JSON.stringify(portfolioGroups.value))
    }
    closeContextMenu()
  }

  return {
    portfolioGroups, fundGroupMap, showGroupModal, editingGroup, groupName, contextMenu,
    openAddGroupModal, openEditGroupModal, closeGroupModal, saveGroup, deleteGroup,
    assignFundToGroup, openGroupContextMenu, closeContextMenu, renameGroupFromMenu, deleteGroupFromMenu,
  }
}

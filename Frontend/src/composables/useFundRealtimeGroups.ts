// @ts-nocheck
import { ref, nextTick, onMounted } from 'vue'
import { portfolioAPI } from '../services/portfolioApi'

export function useFundRealtimeGroups() {
  const portfolioGroups = ref([])
  const fundGroupMap = ref({})
  const showGroupModal = ref(false)
  const editingGroup = ref(null)
  const groupName = ref('')
  const rebalanceForm = ref({ enabled: false, target: null, upper: null, lower: null })
  const contextMenu = ref({ show: false, x: 0, y: 0, groupId: null })

  onMounted(async () => {
    try {
      const [groupsRes, mapRes] = await Promise.all([
        portfolioAPI.getGroups(),
        portfolioAPI.getGroupMap(),
      ])
      if (Array.isArray(groupsRes?.data)) portfolioGroups.value = groupsRes.data
      if (mapRes?.data && typeof mapRes.data === 'object') fundGroupMap.value = mapRes.data
    } catch { /* API not available */ }
  })

  const openAddGroupModal = () => {
    editingGroup.value = null
    groupName.value = ''
    rebalanceForm.value = { enabled: false, target: null, upper: null, lower: null }
    showGroupModal.value = true
    nextTick(() => {
      const input = document.querySelector('.group-name-input')
      if (input) input.focus()
    })
  }

  const openEditGroupModal = (group) => {
    editingGroup.value = group
    groupName.value = group.name
    rebalanceForm.value = {
      enabled: !!group.rebalance_enabled,
      target: group.rebalance_target ?? null,
      upper: group.rebalance_upper ?? null,
      lower: group.rebalance_lower ?? null,
    }
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

  const saveGroup = async () => {
    const name = groupName.value.trim()
    if (!name) return
    if (editingGroup.value) {
      const id = editingGroup.value.id
      const idx = portfolioGroups.value.findIndex(g => g.id === id)
      if (idx !== -1) {
        portfolioGroups.value[idx] = {
          ...portfolioGroups.value[idx],
          name,
          rebalance_enabled: rebalanceForm.value.enabled ? 1 : 0,
          rebalance_target: rebalanceForm.value.target,
          rebalance_upper: rebalanceForm.value.upper,
          rebalance_lower: rebalanceForm.value.lower,
        }
      }
      try {
        await portfolioAPI.updateGroup(id, {
          name,
          rebalance_enabled: rebalanceForm.value.enabled ? 1 : 0,
          rebalance_target: rebalanceForm.value.target,
          rebalance_upper: rebalanceForm.value.upper,
          rebalance_lower: rebalanceForm.value.lower,
        })
      } catch { /* fallback */ }
    } else {
      const localId = 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
      const newGroup = {
        id: localId, name,
        rebalance_enabled: rebalanceForm.value.enabled ? 1 : 0,
        rebalance_target: rebalanceForm.value.target,
        rebalance_upper: rebalanceForm.value.upper,
        rebalance_lower: rebalanceForm.value.lower,
      }
      portfolioGroups.value.push(newGroup)
      try {
        const res = await portfolioAPI.createGroup(name, {
          rebalance_enabled: rebalanceForm.value.enabled ? 1 : 0,
          rebalance_target: rebalanceForm.value.target,
          rebalance_upper: rebalanceForm.value.upper,
          rebalance_lower: rebalanceForm.value.lower,
        })
        if (res?.data?.id) newGroup.id = res.data.id
      } catch { /* fallback */ }
    }
    closeGroupModal()
  }

  const deleteGroup = async (groupId) => {
    const group = portfolioGroups.value.find(g => g.id === groupId)
    if (!group) return
    if (!confirm(`确定删除分组"${group.name}"吗？分组内的基金将回到默认状态。`)) return
    const newMap = { ...fundGroupMap.value }
    Object.keys(newMap).forEach(code => {
      if (newMap[code] === groupId) delete newMap[code]
    })
    fundGroupMap.value = newMap
    portfolioGroups.value = portfolioGroups.value.filter(g => g.id !== groupId)
    try {
      if (typeof groupId === 'number') {
        await portfolioAPI.deleteGroup(groupId)
      } else {
        const mappings = Object.entries(fundGroupMap.value).map(([code, gid]) => ({
          fund_code: code, group_id: gid != null ? String(gid) : null
        }))
        await portfolioAPI.syncGroupMap(mappings)
      }
    } catch { /* fallback */ }
  }

  const assignFundToGroup = async (fundCode, groupId) => {
    const newMap = { ...fundGroupMap.value }
    if (!groupId) {
      delete newMap[fundCode]
    } else {
      newMap[fundCode] = groupId
    }
    fundGroupMap.value = newMap
    syncGroupMapDebounced()
  }

  let syncTimeout = null
  const syncGroupMapDebounced = () => {
    if (syncTimeout) clearTimeout(syncTimeout)
    syncTimeout = setTimeout(async () => {
      const mappings = Object.entries(fundGroupMap.value).map(([code, gid]) => ({
        fund_code: code, group_id: gid != null ? String(gid) : null
      }))
      try { await portfolioAPI.syncGroupMap(mappings)
      } catch { /* fallback */ }
      syncTimeout = null
    }, 2000)
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
      deleteGroup(groupId)
    }
    closeContextMenu()
  }

  return {
    portfolioGroups, fundGroupMap, showGroupModal, editingGroup, groupName, rebalanceForm, contextMenu,
    openAddGroupModal, openEditGroupModal, closeGroupModal, saveGroup, deleteGroup,
    assignFundToGroup, openGroupContextMenu, closeContextMenu, renameGroupFromMenu, deleteGroupFromMenu,
  }
}

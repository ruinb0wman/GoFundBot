/* eslint-disable max-lines */
import Decimal from 'decimal.js'
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import { screeningAPI, fundAPI } from '../services/api'
import { useWatchlistStore } from '../stores/watchlistStore'
import { translate } from '../locales/index'
import { fmtNumber, returnClass as calcReturnClass } from '../utils/number'

export function useFundScreening(emit) {
    const dbStatus = ref({
        basic_count: 0,
        latest_update: null,
        type_counts: {}
    })

    const updateStatus = ref({
        running: false,
        progress: 0,
        total: 0,
        current_fund: '',
        success_count: 0,
        fail_count: 0,
        message: ''
    })

    const selectedFundTypes = ref([])
    const showUpdateDialog = ref(false)
    const updateTasks = reactive({
        basic: true,
        indicators: true,
        market: true
    })
    const hasSelectedUpdateTask = computed(() => Object.values(updateTasks).some(Boolean))

    const showIndustryDictDialog = ref(false)
    let resolveIndustryDictPromise = null
    const resolveIndustryDict = (value) => {
        showIndustryDictDialog.value = false
        if (resolveIndustryDictPromise) {
            resolveIndustryDictPromise(value)
            resolveIndustryDictPromise = null
        }
    }
    const askIndustryDictionary = () => {
        return new Promise((resolve) => {
            resolveIndustryDictPromise = resolve
            showIndustryDictDialog.value = true
        })
    }

    const showAdvanced = ref(false)
    const showTypeDropdown = ref(false)
    const typeDropdownRef = ref(null)
    const searchWrapRef = ref(null)

    const searchSuggestions = ref([])
    const showSearchDropdown = ref(false)
    let searchDebounce = null

    const onSearchFocus = () => {
        if (searchSuggestions.value.length > 0) {
            showSearchDropdown.value = true
        }
    }

    const selectSearchSuggestion = (item) => {
        filters.keyword = item.CODE
        showSearchDropdown.value = false
        search(true)
    }

    const handleSearchClickOutside = (e) => {
        if (searchWrapRef.value && !searchWrapRef.value.contains(e.target)) {
            showSearchDropdown.value = false
        }
    }

    const advFilters = reactive({
        return_1m_min: null,
        return_1m_max: null,
        return_3m_min: null,
        return_3m_max: null,
        return_6m_min: null,
        return_6m_max: null,
        return_1y_min: null,
        return_1y_max: null,
        return_3y_min: null,
        return_3y_max: null,
        annual_return_1y_min: null,
        annual_return_1y_max: null,
        annual_return_3y_min: null,
        annual_return_3y_max: null,
        max_drawdown_3m_max: null,
        max_drawdown_6m_max: null,
        max_drawdown_1y_max: null,
        max_drawdown_3y_max: null,
        max_drawdown_all_max: null,
        volatility_1y_max: null,
        volatility_3y_max: null,
        sharpe_ratio_1y_min: null,
        sharpe_ratio_3y_min: null,
        calmar_ratio_1y_min: null,
        calmar_ratio_3y_min: null,
        rank_pct_1m_max: null,
        rank_pct_3m_max: null,
        rank_pct_6m_max: null,
        rank_pct_1y_max: null,
        rank_pct_2y_max: null,
        rank_pct_3y_max: null,
        pass_4433: false,
    })

    const advancedFilterGroups = [
        {
            title: '收益表现',
            items: [
                { type: 'range', label: '近1月收益率', minKey: 'return_1m_min', maxKey: 'return_1m_max', unit: '%' },
                { type: 'range', label: '近3月收益率', minKey: 'return_3m_min', maxKey: 'return_3m_max', unit: '%' },
                { type: 'range', label: '近6月收益率', minKey: 'return_6m_min', maxKey: 'return_6m_max', unit: '%' },
                { type: 'range', label: '近1年收益率', minKey: 'return_1y_min', maxKey: 'return_1y_max', unit: '%' },
                { type: 'range', label: '近3年收益率', minKey: 'return_3y_min', maxKey: 'return_3y_max', unit: '%' },
                { type: 'range', label: '1年年化收益率', minKey: 'annual_return_1y_min', maxKey: 'annual_return_1y_max', unit: '%' },
                { type: 'range', label: '3年年化收益率', minKey: 'annual_return_3y_min', maxKey: 'annual_return_3y_max', unit: '%' }
            ]
        },
        {
            title: '风险控制',
            items: [
                { label: '近3月最大回撤', key: 'max_drawdown_3m_max', operator: '<=', placeholder: '如 10', unit: '%' },
                { label: '近6月最大回撤', key: 'max_drawdown_6m_max', operator: '<=', placeholder: '如 15', unit: '%' },
                { label: '近1年最大回撤', key: 'max_drawdown_1y_max', operator: '<=', placeholder: '如 20', unit: '%' },
                { label: '近3年最大回撤', key: 'max_drawdown_3y_max', operator: '<=', placeholder: '如 30', unit: '%' },
                { label: '成立以来最大回撤', key: 'max_drawdown_all_max', operator: '<=', placeholder: '如 40', unit: '%' },
                { label: '1年波动率', key: 'volatility_1y_max', operator: '<=', placeholder: '如 25', unit: '%' },
                { label: '3年波动率', key: 'volatility_3y_max', operator: '<=', placeholder: '如 25', unit: '%' },
                { label: '1年夏普', key: 'sharpe_ratio_1y_min', operator: '>=', placeholder: '如 1.5' },
                { label: '3年夏普', key: 'sharpe_ratio_3y_min', operator: '>=', placeholder: '如 1.2' },
                { label: '1年卡玛', key: 'calmar_ratio_1y_min', operator: '>=', placeholder: '如 1' },
                { label: '3年卡玛', key: 'calmar_ratio_3y_min', operator: '>=', placeholder: '如 1' }
            ]
        },
        {
            title: '同类排名',
            items: [
                { label: '近1月排名百分位', key: 'rank_pct_1m_max', operator: '<=', placeholder: '如 33', unit: '%' },
                { label: '近3月排名百分位', key: 'rank_pct_3m_max', operator: '<=', placeholder: '如 33', unit: '%' },
                { label: '近6月排名百分位', key: 'rank_pct_6m_max', operator: '<=', placeholder: '如 33', unit: '%' },
                { label: '近1年排名百分位', key: 'rank_pct_1y_max', operator: '<=', placeholder: '如 25', unit: '%' },
                { label: '近2年排名百分位', key: 'rank_pct_2y_max', operator: '<=', placeholder: '如 25', unit: '%' },
                { label: '近3年排名百分位', key: 'rank_pct_3y_max', operator: '<=', placeholder: '如 25', unit: '%' },
                { type: 'checkbox', label: '4433法则', key: 'pass_4433', text: '只看通过' }
            ]
        }
    ]

    const filters = reactive({
        keyword: '',
        fund_types: [],
        industry_tags: [],
        return_1y_min: null,
        return_1y_max: null,
        max_drawdown_max: null,
        sharpe_min: null,
        volatility_max: null,
        calmar_min: null
    })

    const fundTypeCategories = [
        {
            name: '偏股型',
            icon: 'TrendingUp',
            expanded: true,
            types: [
                { value: '混合型-偏股', label: '偏股混合' },
                { value: '混合型-灵活', label: '灵活配置' },
                { value: '混合型-平衡', label: '平衡混合' },
                { value: '股票型', label: '股票型' },
                { value: '股票指数', label: '股票指数' },
                { value: '联接基金', label: '联接基金' }
            ]
        },
        {
            name: '偏债型',
            icon: 'BarChart3',
            expanded: false,
            types: [
                { value: '混合型-偏债', label: '偏债混合' },
                { value: '债券型-长债', label: '长期纯债' },
                { value: '债券型-中短债', label: '中短债' },
                { value: '债券型', label: '债券型(全部)' },
                { value: '债券指数', label: '债券指数' }
            ]
        },
        {
            name: '货币/其他',
            icon: '💰',
            expanded: false,
            types: [
                { value: '货币型', label: '货币型' },
                { value: 'FOF', label: 'FOF' },
                { value: 'QDII', label: 'QDII' },
                { value: 'QDII-指数', label: 'QDII指数' },
                { value: 'REITs', label: 'REITs' }
            ]
        }
    ]

    const fundTypeOptions = computed(() => {
        const allTypes = []
        fundTypeCategories.forEach(cat => {
            cat.types.forEach(t => allTypes.push(t))
        })
        return allTypes
    })

    const sortBy = ref('return_1y')
    const sortOrder = ref('desc')

    const quickTypeFilter = ref('')
    const availableTypes = ref([])
    const activeQuickDropdown = ref(null)

    const fundTypeGroups = ref([])
    const sectorGroups = ref([])
    const ungroupedTags = ref([])
    const expandedGroups = ref(new Set())
    const sectorExpanded = ref(true)
    const screeningGridRef = ref(null)

    const fallbackSectorBuckets = [
        { name: '全球市场', patterns: ['全球', '海外', '港股', '美股', '日本', '印度', '越南', '德国', '法国', '英国', '韩国', '东南亚', '新兴市场', '纳斯达克', '标普', '恒生', '中概'] },
        { name: '科技制造', patterns: ['科技', '半导体', '芯片', '电子', '计算机', '通信', '人工智能', '软件', '互联网', '传媒', '游戏', '新能源车', '汽车', '机器人', '高端制造', '军工', '机械', '电力设备'] },
        { name: '消费医药', patterns: ['消费', '食品', '饮料', '白酒', '家电', '农业', '养殖', '医药', '医疗', '生物', '创新药', '中药', '养老'] },
        { name: '周期资源', patterns: ['煤炭', '钢铁', '有色', '金属', '黄金', '石油', '化工', '资源', '能源', '电力', '环保', '建筑', '建材', '交运', '航运'] },
        { name: '金融地产', patterns: ['银行', '证券', '保险', '金融', '地产', '房地产', '非银'] },
        { name: '固收与策略', patterns: ['债券', '纯债', '短债', '可转债', '货币', '红利', '量化', '价值', '成长', '低波', '策略'] },
    ]

    const getFallbackSectorName = (tagName) => {
        const text = String(tagName || '')
        const bucket = fallbackSectorBuckets.find(item =>
            item.patterns.some(pattern => text.includes(pattern))
        )
        return bucket ? bucket.name : '其他主题'
    }

    const isBroadIndexTag = (tagName) => {
        const text = String(tagName || '')
        const patterns = ['沪深300', '中证500', '上证50', '创业板', '科创50', '中证1000', '中证2000', '宽基', '指数', '联接']
        return patterns.some(pattern => text.includes(pattern))
    }

    const normalizeIndustryGroup = (group) => {
        const groupName = group.name || '其他主题'
        const rawTags = Array.isArray(group.tags) ? group.tags : []
        const childTags = rawTags
            .filter(tag => tag && tag.name && tag.name !== groupName)
            .sort((a, b) => (b.count || 0) - (a.count || 0))
        return {
            name: groupName,
            count: group.count || childTags.reduce((sum, tag) => sum + (tag.count || 0), 0),
            tags: childTags,
        }
    }

    const displaySectorGroups = computed(() => {
        const grouped = new Map()
        const addGroup = (group) => {
            const normalized = normalizeIndustryGroup(group)
            const existing = grouped.get(normalized.name)
            if (existing) {
                existing.count += normalized.count
                existing.tags.push(...normalized.tags)
            } else {
                grouped.set(normalized.name, normalized)
            }
        }

        sectorGroups.value.forEach(addGroup)

        ungroupedTags.value.forEach(tag => {
            if (isBroadIndexTag(tag.name)) return
            const groupName = getFallbackSectorName(tag.name)
            if (!grouped.has(groupName)) {
                grouped.set(groupName, { name: groupName, count: 0, tags: [] })
            }
            const group = grouped.get(groupName)
            group.count += tag.count || 0
            group.tags.push(tag)
        })

        return Array.from(grouped.values())
            .map(group => ({
                ...group,
                tags: group.tags
                    .filter((tag, index, arr) => arr.findIndex(item => item.name === tag.name) === index)
                    .sort((a, b) => (b.count || 0) - (a.count || 0))
            }))
            .sort((a, b) => (b.count || 0) - (a.count || 0))
    })

    const displayFundTypeGroups = computed(() => {
        const groups = fundTypeGroups.value.map(group => ({
            ...group,
            tags: [...(group.tags || [])],
        }))
        const indexTags = ungroupedTags.value.filter(tag => isBroadIndexTag(tag.name))
        if (indexTags.length) {
            let indexGroup = groups.find(group => group.name === '宽基指数')
            if (!indexGroup) {
                indexGroup = { name: '宽基指数', count: 0, tags: [] }
                groups.push(indexGroup)
            }
            indexGroup.tags.push(...indexTags)
            indexGroup.tags = indexGroup.tags
                .filter((tag, index, arr) => arr.findIndex(item => item.name === tag.name) === index)
                .sort((a, b) => (b.count || 0) - (a.count || 0))
            indexGroup.count = indexGroup.tags.reduce((sum, tag) => sum + (tag.count || 0), 0)
        }
        return groups.sort((a, b) => (b.count || 0) - (a.count || 0))
    })

    const toggleGroup = (name) => {
        const s = new Set(expandedGroups.value)
        if (s.has(name)) s.delete(name)
        else s.add(name)
        expandedGroups.value = s
    }

    const handlePrimaryIndustryClick = (group) => {
        if (group.tags.length) {
            toggleGroup(group.name)
        } else {
            toggleIndustryTag(group.name)
        }
    }

    const isGroupActive = (group) => {
        if (expandedGroups.value.has(group.name)) return true
        if (group.tags.length) {
            return group.tags.some(tag => filters.industry_tags.includes(tag.name))
        }
        return filters.industry_tags.includes(group.name)
    }

    const allSelectableTags = computed(() => {
        const result = []
        for (const g of displayFundTypeGroups.value) {
            for (const t of g.tags) result.push(t)
        }
        for (const g of displaySectorGroups.value) {
            for (const t of g.tags) result.push(t)
        }
        return result
    })

    const visibleSectorGroups = computed(() => {
        if (sectorExpanded.value) return displaySectorGroups.value
        return displaySectorGroups.value.slice(0, 8)
    })

    const quickTypeCategories = [
        {
            name: '偏股型',
            icon: 'TrendingUp',
            patterns: ['混合型-偏股', '混合型-灵活', '混合型-平衡', '股票型', '股票指数', '指数型-股票', '联接基金', '增强指数', '被动指数', '指数-股票']
        },
        {
            name: '偏债型',
            icon: 'BarChart3',
            patterns: ['混合型-偏债', '债券型', '债券指数', '指数型-固收', '短债', '中短债', '长债', '纯债', '可转债', '指数-债券']
        },
        {
            name: 'FOF',
            icon: 'Target',
            patterns: ['FOF']
        },
        {
            name: 'QDII',
            icon: 'Globe',
            patterns: ['QDII', '海外指数', '指数型-海外']
        },
        {
            name: '货币/其他',
            icon: 'Coins',
            patterns: ['货币', 'REITs', '商品', '指数-其他', '指数型-其他', '其他']
        }
    ]

    const getTypeCategoryName = (type) => {
        for (const cat of quickTypeCategories) {
            if (cat.patterns.some(p => type.includes(p))) {
                return cat.name
            }
        }
        return null
    }

    const toggleQuickDropdown = (categoryName) => {
        if (activeQuickDropdown.value === categoryName) {
            activeQuickDropdown.value = null
        } else {
            activeQuickDropdown.value = categoryName
        }
    }

    const closeQuickDropdown = () => {
        activeQuickDropdown.value = null
    }

    const getFilteredCategoryTypes = (category) => {
        return (category.patterns || []).map(p => ({
            value: p,
            label: p,
            available: availableTypes.value.some(t => t.includes(p))
        }))
    }

    const isCategoryTypeActive = (category) => {
        if (!quickTypeFilter.value) return false
        return getTypeCategoryName(quickTypeFilter.value) === category.name
    }

    const hasCategoryActiveType = (category) => {
        return getFilteredCategoryTypes(category).length > 0
    }

    const uncategorizedTypes = computed(() => {
        return availableTypes.value.filter(type => getTypeCategoryName(type) === null)
    })

    const currentPage = ref(1)
    const pageSize = ref(20)
    const totalCount = ref(0)
    const totalPages = computed(() => Math.ceil(totalCount.value / pageSize.value))

    const results = ref([])
    const loading = ref(false)
    const searched = ref(false)

    const watchlistCodes = ref(new Set())

    const isInWatchlist = (code) => watchlistCodes.value.has(code)

    const fetchWatchlistCodes = async () => {
        try {
            const watchlistStore = useWatchlistStore()
            await watchlistStore.fetch()
            watchlistCodes.value = new Set(watchlistStore.funds.map(f => f.fund_code).filter(Boolean))
        } catch (e) {
            // ignore
        }
    }

    const gridOptions = reactive({
        border: true,
        stripe: true,
        showOverflow: true,
        height: 1000,
        rowConfig: {
            isHover: true
        },
        toolbarConfig: {
            export: true,
            print: true,
            zoom: true,
            custom: true
        },
        exportConfig: {
            filename: '基金筛选结果',
            type: 'csv'
        },
        printConfig: {},
        columns: [
            { type: 'seq', width: 54, title: '序号', fixed: 'left' },
            { field: 'fund_code', title: '基金代码', width: 110, sortable: true, fixed: 'left' },
            { field: 'fund_name', title: '基金名称', minWidth: 190, sortable: true, fixed: 'left', slots: { default: 'fundName' } },
            { field: 'industry_tag_name', title: '板块', width: 110, sortable: true, slots: { default: 'industryTag' } },
            { field: 'fund_type', title: '类型', width: 130, sortable: true },
            { field: 'return_1m', title: '近1月', width: 100, sortable: true, slots: { default: 'percent' } },
            { field: 'return_3m', title: '近3月', width: 100, sortable: true, slots: { default: 'percent' } },
            { field: 'return_6m', title: '近6月', width: 100, sortable: true, slots: { default: 'percent' } },
            { field: 'return_1y', title: '近1年', width: 100, sortable: true, slots: { default: 'percent' } },
            { field: 'return_3y', title: '近3年', width: 100, sortable: true, slots: { default: 'percent' } },
            { field: 'max_drawdown_1y', title: '最大回撤', width: 110, sortable: true, slots: { default: 'drawdown' } },
            { field: 'volatility_1y', title: '波动率', width: 100, sortable: true, slots: { default: 'percent' } },
            { field: 'sharpe_ratio_1y', title: '夏普', width: 90, sortable: true, slots: { default: 'sharpe' } },
            { field: 'sharpe_ratio_3y', title: '3年夏普', width: 100, sortable: true, slots: { default: 'number' } },
            { field: 'calmar_ratio_1y', title: '卡玛', width: 90, sortable: true, slots: { default: 'calmar' } },
            { field: 'rank_pct_3y', title: '3年排名%', width: 110, sortable: true, slots: { default: 'number' } },
            { field: 'pass_4433', title: '4433', width: 80, slots: { default: 'pass4433' } },
            { field: 'updated_time', title: '更新时间', minWidth: 160, sortable: true },
            { title: '操作', width: 110, fixed: 'right', slots: { default: 'actions' } }
        ]
    })

    const sortConfig = reactive({
        remote: true,
        trigger: 'default'
    })

    const progressPercent = computed(() => {
        const status = updateStatus.value
        if (!status.total || status.total === 0) {
            const sc = status.success_count || 0
            if (sc > 0) return Math.min(10 + (sc / Math.max(sc + 100, 1)) * 80, 90)
            return 2
        }
        return Math.max(1, Math.round((status.progress / status.total) * 100))
    })

    const isProgressIndeterminate = computed(() => {
        return !updateStatus.value.total || updateStatus.value.total === 0
    })

    let statusPollTimer = null

    const fetchDbStatus = async () => {
        try {
            const res = await screeningAPI.getStatus()
            dbStatus.value = res.data
            if (res.data.update_status) {
                updateStatus.value = res.data.update_status
            }
        } catch (err) {
            updateStatus.value.running = false
            console.error('获取状态失败:', err)
        }
    }

    const openUpdateDialog = () => {
        showUpdateDialog.value = true
    }

    const closeUpdateDialog = () => {
        if (!updateStatus.value.running) {
            showUpdateDialog.value = false
        }
    }

    const startUpdate = async () => {
        if (!hasSelectedUpdateTask.value) {
            alert(translate('fund.screening.selectTask'))
            return
        }
        let buildIndustryDictionary = false
        if (updateTasks.industry) {
            buildIndustryDictionary = await askIndustryDictionary()
        }
        try {
            showUpdateDialog.value = false
            updateStatus.value = {
                running: true,
                progress: 0,
                total: 0,
                current_fund: '',
                success_count: 0,
                fail_count: 0,
                message: '正在启动更新任务...'
            }
            await screeningAPI.startUpdate({
                fund_types: selectedFundTypes.value,
                build_industry_dictionary: buildIndustryDictionary,
                tasks: {
                    basic: updateTasks.basic,
                    rankings: updateTasks.indicators,
                    risk: updateTasks.indicators,
                    industry_performance: updateTasks.indicators,
                    industry: updateTasks.market
                }
            })
            startStatusPoll()
        } catch (err) {
            updateStatus.value.running = false
            if (err.response?.status === 409) {
                alert(translate('fund.screening.updateInProgress'))
            } else {
                console.error('启动更新失败:', err)
                alert(translate('fund.screening.updateFailed'))
            }
        }
    }

    const stopUpdate = async () => {
        try {
            await screeningAPI.stopUpdate()
        } catch (err) {
            console.error('停止更新失败:', err)
        }
    }

    const fetchProgress = async () => {
        try {
            const res = await screeningAPI.getProgress()
            if (res.data) {
                updateStatus.value = res.data
            }
            const d = res.data
            const looksComplete = d.total > 0 && d.progress >= d.total
            if (!d.running && (looksComplete || d.total === 0)) {
                stopStatusPoll()
                fetchDbStatus()
            }
        } catch (err) {
            console.error('获取进度失败:', err)
        }
    }

    const startStatusPoll = () => {
        if (statusPollTimer) return
        statusPollTimer = setInterval(() => {
            fetchProgress()
        }, 1500)
    }

    const stopStatusPoll = () => {
        if (statusPollTimer) {
            clearInterval(statusPollTimer)
            statusPollTimer = null
        }
    }

    const buildFilterParams = () => {
        const params = {}
        if (filters.keyword) params.keyword = filters.keyword
        if (filters.fund_types.length) params.fund_types = [...filters.fund_types]
        if (filters.industry_tags.length) params.industry_tags = [...filters.industry_tags]
        if (quickTypeFilter.value) params.quick_fund_type = quickTypeFilter.value
        for (const [key, value] of Object.entries(advFilters)) {
            if (typeof value === 'boolean') {
                if (value) params[key] = value
            } else if (value !== null && value !== '' && Number.isFinite(Number(value))) {
                params[key] = Number(value)
            }
        }
        return params
    }

    const resetFilters = () => {
        filters.keyword = ''
        filters.fund_types = []
        filters.industry_tags = []
        Object.keys(advFilters).forEach(k => {
            advFilters[k] = typeof advFilters[k] === 'boolean' ? false : null
        })
        quickTypeFilter.value = ''
    }

    const fetchIndustryTags = async () => {
        try {
            const res = await screeningAPI.getIndustryTags()
            const data = res.data || {}
            fundTypeGroups.value = data.fundTypeGroups || []
            sectorGroups.value = data.sectorGroups || []
            ungroupedTags.value = data.ungrouped || []
        } catch (err) {
            console.error('加载板块标签失败:', err)
            fundTypeGroups.value = []
            sectorGroups.value = []
            ungroupedTags.value = []
        }
    }

    const toggleIndustryTag = (name) => {
        const idx = filters.industry_tags.indexOf(name)
        if (idx > -1) {
            filters.industry_tags.splice(idx, 1)
        } else {
            filters.industry_tags.push(name)
        }
        search(true)
    }

    const clearIndustryTags = () => {
        filters.industry_tags = []
        search(true)
    }

    const search = async (resetPage = false) => {
        loading.value = true
        searched.value = true

        if (resetPage) currentPage.value = 1

        try {
            const cleanFilters = buildFilterParams()

            const res = await screeningAPI.query({
                ...cleanFilters,
                sort_by: sortBy.value,
                sort_order: sortOrder.value,
                page: currentPage.value,
                page_size: pageSize.value
            })

            const responseData = res.data.data || {}
            results.value = responseData.funds || []
            totalCount.value = responseData.total || 0

            if (!quickTypeFilter.value) {
                const types = new Set()
                results.value.forEach(f => {
                    if (f.fund_type) types.add(f.fund_type)
                })
                const existingTypes = new Set(availableTypes.value)
                types.forEach(t => existingTypes.add(t))
                availableTypes.value = Array.from(existingTypes).sort()
            }
        } catch (err) {
            console.error('筛选失败:', err)
            results.value = []
            totalCount.value = 0
        } finally {
            loading.value = false
        }
    }

    const setQuickTypeFilter = (type) => {
        quickTypeFilter.value = type
        activeQuickDropdown.value = null
        currentPage.value = 1
        search()
    }

    const getShortTypeName = (type) => {
        if (!type) return '未知'
        const shortNames = {
            '混合型-偏股': '偏股混合',
            '混合型-灵活': '灵活配置',
            '混合型-偏债': '偏债混合',
            '混合型-平衡': '平衡混合',
            '指数型-股票': '股票指数',
            '指数型-固收': '债券指数',
            '指数型-海外股票': '海外指数',
            '债券型-长债': '长期债券',
            '债券型-中短债': '中短债',
            '债券型-混合一级': '一级债基',
            '债券型-混合二级': '二级债基',
            '货币型-普通货币': '货币基金',
            'FOF-稳健型': 'FOF稳健',
            'FOF-均衡型': 'FOF均衡',
            'FOF-进取型': 'FOF进取',
        }
        return shortNames[type] || type.replace('型-', '-').replace('型', '')
    }

    const removeFundType = (type) => {
        const idx = filters.fund_types.indexOf(type)
        if (idx > -1) filters.fund_types.splice(idx, 1)
    }

    const toggleSingleType = (type) => {
        const idx = filters.fund_types.indexOf(type)
        if (idx > -1) {
            filters.fund_types.splice(idx, 1)
        } else {
            filters.fund_types.push(type)
        }
    }

    const toggleCategoryTypes = (cat) => {
        const typeVals = cat.types.map(t => t.value)
        const allSelected = typeVals.every(v => filters.fund_types.includes(v))
        if (allSelected) {
            for (const v of typeVals) {
                const idx = filters.fund_types.indexOf(v)
                if (idx > -1) filters.fund_types.splice(idx, 1)
            }
        } else {
            for (const v of typeVals) {
                if (!filters.fund_types.includes(v)) {
                    filters.fund_types.push(v)
                }
            }
        }
    }

    const isCatAllSelected = (cat) => cat.types.every(t => filters.fund_types.includes(t.value))
    const isCatPartialSelected = (cat) => {
        const s = cat.types.filter(t => filters.fund_types.includes(t.value)).length
        return s > 0 && s < cat.types.length
    }

    const handleTypeDropdownClick = (e) => {
        if (typeDropdownRef.value && !typeDropdownRef.value.contains(e.target)) {
            showTypeDropdown.value = false
        }
    }

    const handleGridSort = (params = {}) => {
        const field = params.field || params.property || params.column?.field
        if (!field) return
        const nextOrder = params.order || (sortBy.value === field && sortOrder.value === 'desc' ? 'asc' : 'desc')
        sortBy.value = field
        sortOrder.value = nextOrder === 'asc' ? 'asc' : 'desc'
        search(true)
    }

    const handleGridCellClick = ({ row, column }) => {
        if (column?.title === '操作') return
        viewFundDetail(row)
    }

    const viewFundDetail = (fund) => {
        emit('view-fund', fund.fund_code)
    }

    const toggleWatchlist = async (fund) => {
        const code = fund.fund_code
        const watched = isInWatchlist(code)
        const store = useWatchlistStore()
        try {
            if (watched) {
                await store.removeFund(code)
                watchlistCodes.value.delete(code)
                watchlistCodes.value = new Set(watchlistCodes.value)
            } else {
                await store.addFund(code, fund.fund_name, fund.fund_type)
                watchlistCodes.value = new Set([...watchlistCodes.value, code])
            }
        } catch (err) {
            console.error('切换自选失败:', err)
        }
    }

    const addToCompare = (fund) => {
        emit('add-to-compare', {
            code: fund.fund_code,
            name: fund.fund_name
        })
    }

    const formatPercent = (value, isNegative = false) => {
        if (value === null || value === undefined) return '--'
        const num = Number(value)
        if (!Number.isFinite(num)) return '--'
        const formatted = new Decimal(num).toFixed(2)
        if (isNegative) return `-${formatted}%`
        const prefix = num > 0 ? '+' : ''
        return `${prefix}${formatted}%`
    }

    const formatNumber = (value) => fmtNumber(value, 2)

    const formatDate = (dateStr) => {
        if (!dateStr) return '--'
        const date = new Date(dateStr)
        return date.toLocaleString('zh-CN')
    }

    const getReturnClass = (value) => calcReturnClass(value)

    const getSharpeClass = (value) => {
        if (value === null || value === undefined) return ''
        if (value >= 1.5) return 'excellent'
        if (value >= 1) return 'good'
        if (value >= 0.5) return 'normal'
        return 'poor'
    }

    const getCalmarClass = (value) => {
        if (value === null || value === undefined) return ''
        if (value >= 2) return 'excellent'
        if (value >= 1) return 'good'
        if (value >= 0.5) return 'normal'
        return 'poor'
    }

    const changePage = (page) => {
        currentPage.value = page
        search()
    }

    const onPageSizeChange = () => {
        currentPage.value = 1
        search()
    }

    watch(() => filters.keyword, (val) => {
        clearTimeout(searchDebounce)
        const kw = (val || '').trim()
        if (!kw || kw.length < 2) {
            searchSuggestions.value = []
            showSearchDropdown.value = false
            return
        }
        searchDebounce = setTimeout(async () => {
            try {
                const res = await fundAPI.searchFunds(kw)
                searchSuggestions.value = (res.data.data || []).slice(0, 10)
                showSearchDropdown.value = searchSuggestions.value.length > 0
            } catch (e) {
                // ignore
            }
        }, 150)
    })

    onMounted(async () => {
        await fetchProgress()
        fetchDbStatus()
        fetchWatchlistCodes()
        fetchIndustryTags()

        if (updateStatus.value.running) {
            startStatusPoll()
        }

        document.addEventListener('click', closeQuickDropdown)
        document.addEventListener('click', handleTypeDropdownClick)
        document.addEventListener('click', handleSearchClickOutside)
    })

    onUnmounted(() => {
        stopStatusPoll()
        document.removeEventListener('click', closeQuickDropdown)
        document.removeEventListener('click', handleTypeDropdownClick)
        document.removeEventListener('click', handleSearchClickOutside)
    })

    return {
        dbStatus,
        updateStatus,
        showUpdateDialog,
        updateTasks,
        hasSelectedUpdateTask,
        showIndustryDictDialog,
        showAdvanced,
        showTypeDropdown,
        typeDropdownRef,
        searchWrapRef,
        searchSuggestions,
        showSearchDropdown,
        advFilters,
        advancedFilterGroups,
        filters,
        fundTypeCategories,
        expandedGroups,
        sectorExpanded,
        screeningGridRef,
        currentPage,
        totalCount,
        totalPages,
        results,
        loading,
        searched,
        gridOptions,
        sortConfig,
        progressPercent,
        isProgressIndeterminate,
        displayFundTypeGroups,
        displaySectorGroups,
        visibleSectorGroups,
        fundTypeGroups,
        sectorGroups,
        fundTypeOptions,
        allSelectableTags,
        uncategorizedTypes,
        quickTypeFilter,
        availableTypes,
        activeQuickDropdown,
        sortBy,
        sortOrder,
        pageSize,

        resolveIndustryDict,
        onSearchFocus,
        selectSearchSuggestion,
        handleSearchClickOutside,
        removeFundType,
        toggleSingleType,
        toggleCategoryTypes,
        isCatAllSelected,
        isCatPartialSelected,
        openUpdateDialog,
        closeUpdateDialog,
        startUpdate,
        stopUpdate,
        resetFilters,
        fetchIndustryTags,
        toggleIndustryTag,
        clearIndustryTags,
        search,
        setQuickTypeFilter,
        getShortTypeName,
        changePage,
        onPageSizeChange,
        handleGridSort,
        handleGridCellClick,
        toggleWatchlist,
        addToCompare,
        formatPercent,
        formatNumber,
        formatDate,
        getReturnClass,
        getSharpeClass,
        getCalmarClass,
        handlePrimaryIndustryClick,
        isGroupActive,
        isInWatchlist,
        toggleGroup,
        normalizeIndustryGroup,
        getFallbackSectorName,
        isBroadIndexTag,
        fetchDbStatus,
        fetchProgress,
        getTypeCategoryName,
        toggleQuickDropdown,
        closeQuickDropdown,
        getFilteredCategoryTypes,
        isCategoryTypeActive,
        hasCategoryActiveType,
        fetchWatchlistCodes,
        buildFilterParams,
    }
}

import { defineStore } from 'pinia'
import { marketAPI } from '../services/api'

interface NewsItem {
  title: string
  [key: string]: unknown
}

interface SectorItem {
  name: string
  [key: string]: unknown
}

export const useMarketStore = defineStore('market', {
  state: () => ({
    overview: null as unknown | null,
    flashNews: [] as NewsItem[],
    sectors: [] as SectorItem[],
    loading: false,
    lastFetch: 0,
  }),
  actions: {
    async fetchOverview(force = false) {
      const now = Date.now()
      if (!force && this.lastFetch && now - this.lastFetch < 15000) {
        return
      }
      this.loading = true
      try {
        const res = await marketAPI.getOverview()
        this.overview = res.data
        this.lastFetch = now
      } finally {
        this.loading = false
      }
    },
    async fetchFlashNews(count = 30, page = 1) {
      const res = await marketAPI.getFlashNews(count, page)
      this.flashNews = (res.data as { data?: { items?: NewsItem[] } })?.data?.items || []
    },
    async fetchSectors(limit = 90) {
      const res = await marketAPI.getSectorRank(limit)
      this.sectors = ((res.data as { data?: { items?: SectorItem[] } })?.data?.items || []) as SectorItem[]
    },
  },
})

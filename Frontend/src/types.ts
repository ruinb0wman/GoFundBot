export interface DraggingIndex {
  index: number
  groupId: number | null
}

export interface CompareFund {
  code: string
  name: string
}

export interface SubscriptionRedemption {
  categories?: string[]
  series?: Array<{
    name: string
    data: number[]
  }>
}

export interface FluctuationScale {
  categories?: string[]
  series?: Array<{
    y: number
    mom: string
  }>
}

export interface PortfolioHolding {
  code: string
  name: string
  ratio: number | null
  industryText: string
  industry?: string
  industry_name?: string
  industryName?: string
  sector?: string
  sector_name?: string
  position?: number
  hold_ratio?: number
}

export interface Portfolio {
  stock_codes_new?: PortfolioHolding[]
  stock_codes?: (string | number)[]
}

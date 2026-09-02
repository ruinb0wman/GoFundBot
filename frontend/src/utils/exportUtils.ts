export function exportToCSV(
  rows: Record<string, string | number | null | undefined>[],
  columns: { key: string; label: string }[],
  filename: string
): void {
  const BOM = '\uFEFF'
  const header = columns.map(c => c.label).join(',')
  const body = rows
    .map(row => columns.map(c => {
      const val = row[c.key]
      if (val === null || val === undefined) return ''
      const str = String(val)
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"'
      }
      return str
    }).join(','))
    .join('\n')

  const blob = new Blob([BOM + header + '\n' + body], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : filename + '.csv'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

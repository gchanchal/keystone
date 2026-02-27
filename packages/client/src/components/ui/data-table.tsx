import * as React from "react"
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Filter,
  X,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table"
import { Button } from "./button"
import { Input } from "./input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu"
import { Badge } from "./badge"
import { cn } from "@/lib/utils"

export interface ColumnDef<T> {
  id: string
  header: string
  accessorKey?: keyof T | ((row: T) => any)
  cell?: (row: T, index?: number) => React.ReactNode
  sortable?: boolean
  filterable?: boolean
  filterType?: 'text' | 'select' | 'number' | 'date'
  filterOptions?: { label: string; value: string }[]
  width?: string
  minWidth?: number
  resizable?: boolean
  align?: 'left' | 'center' | 'right'
  className?: string
}

interface DataTableProps<T> {
  data: T[]
  columns: ColumnDef<T>[]
  pageSize?: number
  showPagination?: boolean
  showGlobalSearch?: boolean
  isLoading?: boolean
  emptyMessage?: string
  rowClassName?: (row: T) => string
  onRowClick?: (row: T) => void
  getRowId?: (row: T) => string
  initialFilters?: Record<string, string>
}

type SortDirection = 'asc' | 'desc' | null

interface SortState {
  column: string | null
  direction: SortDirection
}

interface FilterState {
  [key: string]: string
}

export function DataTable<T extends Record<string, any>>({
  data,
  columns,
  pageSize = 20,
  showPagination = true,
  showGlobalSearch = true,
  isLoading = false,
  emptyMessage = "No data found",
  rowClassName,
  onRowClick,
  getRowId,
  initialFilters = {},
}: DataTableProps<T>) {
  const [sortState, setSortState] = React.useState<SortState>({ column: null, direction: null })
  const [filters, setFilters] = React.useState<FilterState>(initialFilters)
  const [globalSearch, setGlobalSearch] = React.useState("")
  const [currentPage, setCurrentPage] = React.useState(1)
  const [activeFilterColumn, setActiveFilterColumn] = React.useState<string | null>(null)

  // Column resizing state
  const [columnWidths, setColumnWidths] = React.useState<Record<string, number>>(() => {
    const widths: Record<string, number> = {}
    columns.forEach(col => {
      if (col.width) {
        const parsed = parseInt(col.width)
        if (!isNaN(parsed)) widths[col.id] = parsed
      }
    })
    return widths
  })
  const [resizingColumn, setResizingColumn] = React.useState<string | null>(null)
  const resizeStartX = React.useRef<number>(0)
  const resizeStartWidth = React.useRef<number>(0)

  // Handle column resize
  const handleResizeStart = React.useCallback((e: React.MouseEvent, columnId: string, currentWidth: number) => {
    e.preventDefault()
    e.stopPropagation()
    setResizingColumn(columnId)
    resizeStartX.current = e.clientX
    resizeStartWidth.current = currentWidth
  }, [])

  React.useEffect(() => {
    if (!resizingColumn) return

    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - resizeStartX.current
      const column = columns.find(c => c.id === resizingColumn)
      const minWidth = column?.minWidth || 50
      const newWidth = Math.max(minWidth, resizeStartWidth.current + diff)
      setColumnWidths(prev => ({ ...prev, [resizingColumn]: newWidth }))
    }

    const handleMouseUp = () => {
      setResizingColumn(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [resizingColumn, columns])

  // Get value from row using accessor
  const getValue = React.useCallback((row: T, column: ColumnDef<T>): any => {
    if (!column.accessorKey) return null
    if (typeof column.accessorKey === 'function') {
      return column.accessorKey(row)
    }
    return row[column.accessorKey]
  }, [])

  // Filter data
  const filteredData = React.useMemo(() => {
    let result = [...data]

    // Apply column filters
    Object.entries(filters).forEach(([columnId, filterValue]) => {
      if (!filterValue) return
      const column = columns.find(c => c.id === columnId)
      if (!column) return

      result = result.filter(row => {
        const value = getValue(row, column)
        if (value === null || value === undefined) return false

        const stringValue = String(value).toLowerCase()
        const searchValue = filterValue.toLowerCase()

        if (column.filterType === 'select') {
          return stringValue === searchValue
        }
        return stringValue.includes(searchValue)
      })
    })

    // Apply global search
    if (globalSearch) {
      const searchLower = globalSearch.toLowerCase()
      result = result.filter(row => {
        return columns.some(column => {
          const value = getValue(row, column)
          if (value === null || value === undefined) return false
          return String(value).toLowerCase().includes(searchLower)
        })
      })
    }

    return result
  }, [data, filters, globalSearch, columns, getValue])

  // Sort data
  const sortedData = React.useMemo(() => {
    if (!sortState.column || !sortState.direction) return filteredData

    const column = columns.find(c => c.id === sortState.column)
    if (!column) return filteredData

    return [...filteredData].sort((a, b) => {
      const aValue = getValue(a, column)
      const bValue = getValue(b, column)

      if (aValue === null || aValue === undefined) return 1
      if (bValue === null || bValue === undefined) return -1

      let comparison = 0
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        comparison = aValue - bValue
      } else if (aValue instanceof Date && bValue instanceof Date) {
        comparison = aValue.getTime() - bValue.getTime()
      } else {
        comparison = String(aValue).localeCompare(String(bValue))
      }

      return sortState.direction === 'desc' ? -comparison : comparison
    })
  }, [filteredData, sortState, columns, getValue])

  // Paginate data
  const paginatedData = React.useMemo(() => {
    if (!showPagination) return sortedData
    const start = (currentPage - 1) * pageSize
    return sortedData.slice(start, start + pageSize)
  }, [sortedData, currentPage, pageSize, showPagination])

  const totalPages = Math.ceil(sortedData.length / pageSize)

  // Reset page when filters change
  React.useEffect(() => {
    setCurrentPage(1)
  }, [filters, globalSearch])

  // Apply initial filters when they change (from URL params)
  React.useEffect(() => {
    if (Object.keys(initialFilters).length > 0) {
      setFilters(initialFilters)
    }
  }, [JSON.stringify(initialFilters)])

  const handleSort = (columnId: string) => {
    setSortState(prev => {
      if (prev.column !== columnId) {
        return { column: columnId, direction: 'asc' }
      }
      if (prev.direction === 'asc') {
        return { column: columnId, direction: 'desc' }
      }
      return { column: null, direction: null }
    })
  }

  const handleFilter = (columnId: string, value: string) => {
    setFilters(prev => ({
      ...prev,
      [columnId]: value,
    }))
  }

  const clearFilter = (columnId: string) => {
    setFilters(prev => {
      const newFilters = { ...prev }
      delete newFilters[columnId]
      return newFilters
    })
  }

  const clearAllFilters = () => {
    setFilters({})
    setGlobalSearch("")
  }

  const activeFiltersCount = Object.values(filters).filter(Boolean).length + (globalSearch ? 1 : 0)

  const getSortIcon = (columnId: string) => {
    if (sortState.column !== columnId) {
      return <ArrowUpDown className="h-4 w-4 text-muted-foreground/50" />
    }
    if (sortState.direction === 'asc') {
      return <ArrowUp className="h-4 w-4 text-primary" />
    }
    return <ArrowDown className="h-4 w-4 text-primary" />
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border bg-card">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-4">
        {showGlobalSearch && (
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search all columns..."
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        )}

        {activeFiltersCount > 0 && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              {activeFiltersCount} filter{activeFiltersCount > 1 ? 's' : ''} active
            </Badge>
            <Button variant="ghost" size="sm" onClick={clearAllFilters} className="h-8 px-2">
              <X className="h-4 w-4" />
              Clear all
            </Button>
          </div>
        )}

        <div className="ml-auto text-sm text-muted-foreground">
          {sortedData.length} of {data.length} rows
        </div>
      </div>

      {/* Table */}
      <div className={cn("rounded-lg border bg-card overflow-x-auto", resizingColumn && "select-none")}>
        <Table style={{ tableLayout: 'fixed', width: '100%' }}>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              {columns.map((column, colIndex) => {
                const width = columnWidths[column.id]
                const isResizable = column.resizable !== false
                return (
                  <TableHead
                    key={column.id}
                    style={{
                      width: width ? `${width}px` : column.width,
                      minWidth: column.minWidth || 50,
                      position: 'relative',
                    }}
                    className={cn(
                      "whitespace-nowrap",
                      column.align === 'center' && "text-center",
                      column.align === 'right' && "text-right"
                    )}
                  >
                    <div className="flex items-center gap-1">
                      {column.sortable !== false ? (
                        <button
                          onClick={() => handleSort(column.id)}
                          className="flex items-center gap-1 hover:text-foreground transition-colors"
                        >
                          <span>{column.header}</span>
                          {getSortIcon(column.id)}
                        </button>
                      ) : (
                        <span>{column.header}</span>
                      )}

                      {column.filterable !== false && (
                        <DropdownMenu
                          open={activeFilterColumn === column.id}
                          onOpenChange={(open) => setActiveFilterColumn(open ? column.id : null)}
                        >
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className={cn(
                                "h-6 w-6 p-0",
                                filters[column.id] && "text-primary"
                              )}
                            >
                              <Filter className="h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-56">
                            <div className="p-2">
                              <p className="text-xs font-medium text-muted-foreground mb-2">
                                Filter by {column.header}
                              </p>
                              {column.filterType === 'select' && column.filterOptions ? (
                                <div className="space-y-1">
                                  {column.filterOptions.map((option) => (
                                    <DropdownMenuItem
                                      key={option.value}
                                      onClick={() => handleFilter(column.id, option.value)}
                                      className={cn(
                                        filters[column.id] === option.value && "bg-primary/10"
                                      )}
                                    >
                                      {option.label}
                                    </DropdownMenuItem>
                                  ))}
                                </div>
                              ) : (
                                <Input
                                  placeholder={`Filter ${column.header.toLowerCase()}...`}
                                  value={filters[column.id] || ''}
                                  onChange={(e) => handleFilter(column.id, e.target.value)}
                                  className="h-8"
                                  autoFocus
                                />
                              )}
                            </div>
                            {filters[column.id] && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => clearFilter(column.id)}>
                                  <X className="mr-2 h-4 w-4" />
                                  Clear filter
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                    {/* Resize handle */}
                    {isResizable && colIndex < columns.length - 1 && (
                      <div
                        className={cn(
                          "absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50 group",
                          resizingColumn === column.id && "bg-primary"
                        )}
                        onMouseDown={(e) => {
                          const headerEl = e.currentTarget.parentElement
                          const currentWidth = headerEl?.offsetWidth || 100
                          handleResizeStart(e, column.id, currentWidth)
                        }}
                      >
                        <div className="absolute right-0 top-0 h-full w-4 -translate-x-1/2" />
                      </div>
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-32 text-center text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              paginatedData.map((row, index) => {
                const absoluteIndex = showPagination ? (currentPage - 1) * pageSize + index + 1 : index + 1;
                return (
                <TableRow
                  key={getRowId ? getRowId(row) : index}
                  onClick={() => onRowClick?.(row)}
                  className={cn(
                    onRowClick && "cursor-pointer",
                    rowClassName?.(row)
                  )}
                >
                  {columns.map((column) => {
                    const width = columnWidths[column.id]
                    return (
                      <TableCell
                        key={column.id}
                        style={{
                          width: width ? `${width}px` : column.width,
                          minWidth: column.minWidth || 50,
                        }}
                        className={cn(
                          column.align === 'center' && "text-center",
                          column.align === 'right' && "text-right",
                          column.className
                        )}
                      >
                        {column.cell ? column.cell(row, absoluteIndex) : getValue(row, column)}
                      </TableCell>
                    )
                  })}
                </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {showPagination && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, sortedData.length)} of {sortedData.length} entries
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => p - 1)}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => p + 1)}
              disabled={currentPage === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

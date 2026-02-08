import { useMemo } from 'react';
import { ArrowRight, Info } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { SYSTEM_FIELDS, SystemFieldKey } from '@/lib/api/templates';

interface ExtractedField {
  index: number;
  name: string;
  type: 'text' | 'date' | 'amount' | 'number' | 'unknown';
  sampleValues: string[];
}

interface FieldMapperProps {
  extractedFields: {
    headers: string[];
    columns: ExtractedField[];
    sampleRows: any[][];
    rowCount: number;
    headerRowIndex: number;
  };
  mappings: Record<string, { source: string; format?: string }>;
  onChange: (mappings: Record<string, { source: string; format?: string }>) => void;
}

export function FieldMapper({ extractedFields, mappings, onChange }: FieldMapperProps) {
  const { columns, sampleRows } = extractedFields;

  // Build reverse mapping (column index -> system field)
  const columnToField = useMemo(() => {
    const map: Record<number, SystemFieldKey> = {};
    for (const [field, mapping] of Object.entries(mappings)) {
      const match = mapping.source.match(/^col_(\d+)$/);
      if (match) {
        map[parseInt(match[1], 10)] = field as SystemFieldKey;
      }
    }
    return map;
  }, [mappings]);

  // Handle mapping change for a column
  const handleMappingChange = (columnIndex: number, systemField: string) => {
    const newMappings = { ...mappings };

    // Remove any existing mapping for this column
    for (const [field, mapping] of Object.entries(newMappings)) {
      if (mapping.source === `col_${columnIndex}`) {
        delete newMappings[field];
      }
    }

    // Add new mapping (unless "ignore")
    if (systemField && systemField !== 'ignore') {
      newMappings[systemField] = { source: `col_${columnIndex}` };

      // Add format hint for date fields
      const column = columns.find(c => c.index === columnIndex);
      if ((systemField === 'date' || systemField === 'valueDate') && column?.type === 'date') {
        const sampleDate = column.sampleValues[0];
        if (sampleDate) {
          // Detect format
          if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(sampleDate)) {
            newMappings[systemField].format = 'DD/MM/YYYY';
          } else if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(sampleDate)) {
            newMappings[systemField].format = 'DD-MM-YYYY';
          } else if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(sampleDate)) {
            newMappings[systemField].format = 'YYYY-MM-DD';
          }
        }
      }
    }

    onChange(newMappings);
  };

  // Get badge color based on type
  const getTypeBadge = (type: string) => {
    switch (type) {
      case 'date':
        return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">date</Badge>;
      case 'amount':
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">amount</Badge>;
      case 'number':
        return <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">number</Badge>;
      case 'text':
        return <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200">text</Badge>;
      default:
        return <Badge variant="outline">unknown</Badge>;
    }
  };

  // Get system field options (filter out already mapped fields)
  const getAvailableFields = (currentColumnIndex: number) => {
    const mapped = new Set(
      Object.entries(mappings)
        .filter(([_, m]) => m.source !== `col_${currentColumnIndex}`)
        .map(([field]) => field)
    );

    return Object.entries(SYSTEM_FIELDS).filter(([key]) => !mapped.has(key));
  };

  return (
    <div className="space-y-4">
      {/* Mapping Table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Extracted Field</th>
              <th className="px-4 py-2 text-center w-12"></th>
              <th className="px-4 py-2 text-left font-medium">Map To</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {columns.map((column) => (
              <tr key={column.index} className="hover:bg-muted/30">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{column.name || `Column ${column.index + 1}`}</span>
                    {getTypeBadge(column.type)}
                    {column.sampleValues.length > 0 && (
                      <Tooltip>
                        <TooltipTrigger>
                          <Info className="h-4 w-4 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-xs">
                          <p className="font-medium mb-1">Sample values:</p>
                          <ul className="text-xs space-y-0.5">
                            {column.sampleValues.slice(0, 3).map((v, i) => (
                              <li key={i} className="truncate">{v || '(empty)'}</li>
                            ))}
                          </ul>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </td>
                <td className="px-2 py-3 text-center">
                  <ArrowRight className="h-4 w-4 text-muted-foreground mx-auto" />
                </td>
                <td className="px-4 py-3">
                  <Select
                    value={columnToField[column.index] || 'ignore'}
                    onValueChange={(value) => handleMappingChange(column.index, value)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select field..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ignore">
                        <span className="text-muted-foreground">(Ignore)</span>
                      </SelectItem>
                      {getAvailableFields(column.index).map(([key, field]) => (
                        <SelectItem key={key} value={key}>
                          <div className="flex items-center gap-2">
                            <span>{field.label}</span>
                            {field.required && (
                              <span className="text-destructive">*</span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Sample Data Preview */}
      {sampleRows.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Sample Data Preview</h4>
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  {columns.map((col) => (
                    <th key={col.index} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                      {col.name || `Col ${col.index + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {sampleRows.slice(0, 3).map((row, rowIdx) => (
                  <tr key={rowIdx}>
                    {columns.map((col) => (
                      <td key={col.index} className="px-3 py-2 whitespace-nowrap max-w-[150px] truncate">
                        {row[col.index] !== undefined && row[col.index] !== null
                          ? String(row[col.index])
                          : '-'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Showing {Math.min(3, sampleRows.length)} of {extractedFields.rowCount} rows
          </p>
        </div>
      )}

      {/* Mapping Summary */}
      <div className="bg-muted/30 rounded-lg p-3">
        <h4 className="text-sm font-medium mb-2">Mapping Summary</h4>
        <div className="flex flex-wrap gap-2">
          {Object.entries(mappings).length === 0 ? (
            <span className="text-sm text-muted-foreground">No fields mapped yet</span>
          ) : (
            Object.entries(mappings).map(([field, mapping]) => {
              const column = columns.find(c => mapping.source === `col_${c.index}`);
              const fieldDef = SYSTEM_FIELDS[field as SystemFieldKey];
              return (
                <Badge key={field} variant="secondary" className="text-xs">
                  {column?.name || mapping.source} → {fieldDef?.label || field}
                </Badge>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

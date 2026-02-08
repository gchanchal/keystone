import { useState } from 'react';
import {
  FileText,
  FileSpreadsheet,
  File,
  CheckCircle,
  Clock,
  Edit,
  Trash2,
  MoreVertical,
  Building2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LearnedTemplate } from '@/lib/api/templates';
import { formatDistanceToNow } from 'date-fns';

interface TemplateCardProps {
  template: LearnedTemplate;
  onEdit: () => void;
  onDelete: () => void;
}

const STATEMENT_TYPE_LABELS: Record<string, string> = {
  bank_statement: 'Bank Statement',
  credit_card: 'Credit Card',
  loan: 'Loan',
  investment: 'Investment',
  other: 'Other',
};

const FILE_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  pdf: FileText,
  xlsx: FileSpreadsheet,
  xls: FileSpreadsheet,
  csv: File,
};

export function TemplateCard({ template, onEdit, onDelete }: TemplateCardProps) {
  const FileIcon = FILE_TYPE_ICONS[template.fileType] || File;

  const lastUsedText = template.lastUsedAt
    ? `Used ${formatDistanceToNow(new Date(template.lastUsedAt), { addSuffix: true })}`
    : 'Never used';

  return (
    <div className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/30 transition-colors">
      <div className="flex items-center gap-4">
        {/* File Type Icon */}
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FileIcon className="h-5 w-5" />
        </div>

        {/* Template Info */}
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-medium">{template.name}</h3>
            <Badge
              variant={template.isActive ? 'default' : 'secondary'}
              className="text-xs"
            >
              {template.isActive ? (
                <>
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Ready
                </>
              ) : (
                'Inactive'
              )}
            </Badge>
          </div>
          <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Building2 className="h-3 w-3" />
              {template.institution.toUpperCase()}
            </span>
            <span>•</span>
            <span>{STATEMENT_TYPE_LABELS[template.statementType] || template.statementType}</span>
            <span>•</span>
            <span>{template.fileType.toUpperCase()}</span>
          </div>
        </div>
      </div>

      {/* Usage Stats & Actions */}
      <div className="flex items-center gap-4">
        <div className="text-right text-sm">
          <div className="font-medium">
            {template.timesUsed || 0} {template.timesUsed === 1 ? 'import' : 'imports'}
          </div>
          <div className="text-muted-foreground text-xs">{lastUsedText}</div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

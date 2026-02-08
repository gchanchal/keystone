import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import { Brain, Plus, Upload, FileText, Trash2, Edit, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { templatesApi, LearnedTemplate } from '@/lib/api/templates';
import { LearningWizard } from '@/components/learn/LearningWizard';
import { TemplateCard } from '@/components/learn/TemplateCard';

export function LearnStatements() {
  const queryClient = useQueryClient();
  const [showWizard, setShowWizard] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<LearnedTemplate | null>(null);
  const [deleteTemplateId, setDeleteTemplateId] = useState<string | null>(null);

  // Fetch templates
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['learned-templates'],
    queryFn: templatesApi.getAll,
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: templatesApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learned-templates'] });
      setDeleteTemplateId(null);
    },
  });

  // File drop handler
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setSelectedFile(acceptedFiles[0]);
      setShowWizard(true);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/csv': ['.csv'],
    },
    maxFiles: 1,
    multiple: false,
  });

  const handleWizardClose = () => {
    setShowWizard(false);
    setSelectedFile(null);
    queryClient.invalidateQueries({ queryKey: ['learned-templates'] });
  };

  const handleEditTemplate = (template: LearnedTemplate) => {
    setEditingTemplate(template);
  };

  const handleDeleteTemplate = (templateId: string) => {
    setDeleteTemplateId(templateId);
  };

  const confirmDelete = () => {
    if (deleteTemplateId) {
      deleteMutation.mutate(deleteTemplateId);
    }
  };

  // Count templates by status
  const activeCount = templates.filter(t => t.isActive).length;
  const totalUsage = templates.reduce((sum, t) => sum + (t.timesUsed || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" />
            Scan & Learn
          </h1>
          <p className="text-muted-foreground mt-1">
            Teach the system to recognize your statement formats
          </p>
        </div>
        <Button onClick={() => setShowWizard(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Learn New
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{templates.length}</div>
            <p className="text-sm text-muted-foreground">Learned Templates</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{activeCount}</div>
            <p className="text-sm text-muted-foreground">Active Templates</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{totalUsage}</div>
            <p className="text-sm text-muted-foreground">Total Imports</p>
          </CardContent>
        </Card>
      </div>

      {/* Templates List */}
      <Card>
        <CardHeader>
          <CardTitle>Learned Templates</CardTitle>
          <CardDescription>
            Templates you've taught the system to recognize
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Clock className="h-5 w-5 animate-spin mr-2" />
              Loading templates...
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Brain className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No templates learned yet</p>
              <p className="text-sm mt-1">Upload a statement to teach the system</p>
            </div>
          ) : (
            <div className="space-y-3">
              {templates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onEdit={() => handleEditTemplate(template)}
                  onDelete={() => handleDeleteTemplate(template.id)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upload Dropzone */}
      <Card>
        <CardHeader>
          <CardTitle>Learn New Statement Format</CardTitle>
          <CardDescription>
            Upload a sample statement to teach the system a new format
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              isDragActive
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25 hover:border-primary/50'
            }`}
          >
            <input {...getInputProps()} />
            <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            {isDragActive ? (
              <p className="text-primary font-medium">Drop the file here...</p>
            ) : (
              <>
                <p className="font-medium">Drag & drop a statement here</p>
                <p className="text-sm text-muted-foreground mt-1">
                  or click to browse (PDF, Excel, CSV)
                </p>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Learning Wizard Dialog */}
      {showWizard && (
        <LearningWizard
          file={selectedFile}
          onClose={handleWizardClose}
          onComplete={handleWizardClose}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTemplateId} onOpenChange={() => setDeleteTemplateId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Template?</DialogTitle>
            <DialogDescription>
              This will permanently delete this learned template. Future uploads of this format will need to be manually configured or re-learned.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTemplateId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

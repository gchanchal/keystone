import { useState, useEffect, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import {
  Loader2,
  Upload,
  CheckCircle,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  FileText,
  Brain,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { learnApi, LearningSession, ExtractionResult } from '@/lib/api/templates';
import { FieldMapper } from './FieldMapper';

interface LearningWizardProps {
  file?: File | null;
  onClose: () => void;
  onComplete: () => void;
}

type Step = 'upload' | 'extracting' | 'mapping' | 'confirm' | 'complete' | 'error';

const INSTITUTIONS = [
  { value: 'hdfc', label: 'HDFC Bank' },
  { value: 'icici', label: 'ICICI Bank' },
  { value: 'sbi', label: 'State Bank of India' },
  { value: 'axis', label: 'Axis Bank' },
  { value: 'kotak', label: 'Kotak Mahindra Bank' },
  { value: 'yes', label: 'Yes Bank' },
  { value: 'idfc', label: 'IDFC First Bank' },
  { value: 'federal', label: 'Federal Bank' },
  { value: 'canara', label: 'Canara Bank' },
  { value: 'pnb', label: 'Punjab National Bank' },
  { value: 'other', label: 'Other' },
];

const STATEMENT_TYPES = [
  { value: 'bank_statement', label: 'Bank Statement' },
  { value: 'credit_card', label: 'Credit Card Statement' },
  { value: 'loan', label: 'Loan Statement' },
  { value: 'investment', label: 'Investment Statement' },
  { value: 'other', label: 'Other' },
];

export function LearningWizard({ file: initialFile, onClose, onComplete }: LearningWizardProps) {
  const [step, setStep] = useState<Step>(initialFile ? 'upload' : 'upload');
  const [file, setFile] = useState<File | null>(initialFile || null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<LearningSession | null>(null);
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [mappings, setMappings] = useState<Record<string, { source: string; format?: string }>>({});
  const [error, setError] = useState<string | null>(null);

  // Template details
  const [templateName, setTemplateName] = useState('');
  const [institution, setInstitution] = useState('');
  const [statementType, setStatementType] = useState<string>('bank_statement');
  const [textPatterns, setTextPatterns] = useState<string[]>([]);

  // Start learning mutation
  const startMutation = useMutation({
    mutationFn: (file: File) => learnApi.start(file),
    onSuccess: (data) => {
      setSessionId(data.sessionId);
      setStep('extracting');
    },
    onError: (err: any) => {
      setError(err.response?.data?.error || 'Failed to start learning');
      setStep('error');
    },
  });

  // Save mappings mutation
  const saveMappingsMutation = useMutation({
    mutationFn: (mappings: Record<string, { source: string; format?: string }>) =>
      learnApi.saveMappings(sessionId!, mappings),
    onSuccess: () => {
      setStep('confirm');
    },
    onError: (err: any) => {
      setError(err.response?.data?.error || 'Failed to save mappings');
    },
  });

  // Complete learning mutation
  const completeMutation = useMutation({
    mutationFn: () =>
      learnApi.complete(sessionId!, {
        name: templateName,
        institution,
        statementType: statementType as any,
        detectionPatterns: { textPatterns },
      }),
    onSuccess: () => {
      setStep('complete');
    },
    onError: (err: any) => {
      setError(err.response?.data?.error || 'Failed to complete learning');
    },
  });

  // Poll for extraction results
  useEffect(() => {
    if (step !== 'extracting' || !sessionId) return;

    const poll = async () => {
      try {
        const result = await learnApi.getExtraction(sessionId);
        setExtraction(result);

        if (result.status === 'mapping') {
          // Set initial mappings from suggestions
          if (result.suggestedMappings) {
            setMappings(result.suggestedMappings);
          }
          // Set detected patterns
          if (result.detectedPatterns?.textPatterns) {
            setTextPatterns(result.detectedPatterns.textPatterns);
          }
          // Auto-suggest template name from patterns
          if (result.detectedPatterns?.textPatterns?.length) {
            const bankPattern = result.detectedPatterns.textPatterns.find(p =>
              INSTITUTIONS.some(i => p.toLowerCase().includes(i.value))
            );
            if (bankPattern) {
              const matchedBank = INSTITUTIONS.find(i =>
                bankPattern.toLowerCase().includes(i.value)
              );
              if (matchedBank) {
                setInstitution(matchedBank.value);
                setTemplateName(`${matchedBank.label} Statement`);
              }
            }
          }
          setStep('mapping');
        } else if (result.status === 'failed') {
          setError(result.error || 'Extraction failed');
          setStep('error');
        }
      } catch (err: any) {
        console.error('Polling error:', err);
      }
    };

    const interval = setInterval(poll, 1500);
    poll(); // Initial poll

    return () => clearInterval(interval);
  }, [step, sessionId]);

  // Handle file upload
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFile(acceptedFiles[0]);
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
    disabled: !!file,
  });

  // Start learning when file is ready
  const handleStartLearning = () => {
    if (file) {
      startMutation.mutate(file);
    }
  };

  // Auto-start if file was provided
  useEffect(() => {
    if (initialFile && step === 'upload') {
      handleStartLearning();
    }
  }, [initialFile]);

  const handleMappingsChange = (newMappings: Record<string, { source: string; format?: string }>) => {
    setMappings(newMappings);
  };

  const handleContinueToConfirm = () => {
    saveMappingsMutation.mutate(mappings);
  };

  const handleComplete = () => {
    completeMutation.mutate();
  };

  const renderStep = () => {
    switch (step) {
      case 'upload':
        return (
          <div className="space-y-4">
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                isDragActive
                  ? 'border-primary bg-primary/5'
                  : file
                  ? 'border-green-500 bg-green-50 dark:bg-green-950'
                  : 'border-muted-foreground/25 hover:border-primary/50'
              }`}
            >
              <input {...getInputProps()} />
              {file ? (
                <div className="flex items-center justify-center gap-3">
                  <FileText className="h-8 w-8 text-green-600" />
                  <div className="text-left">
                    <p className="font-medium">{file.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="font-medium">Drop a statement file here</p>
                  <p className="text-sm text-muted-foreground">
                    PDF, Excel, or CSV
                  </p>
                </>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleStartLearning} disabled={!file || startMutation.isPending}>
                {startMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    Start Learning
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </div>
        );

      case 'extracting':
        return (
          <div className="py-12 text-center">
            <Brain className="h-16 w-16 mx-auto mb-4 text-primary animate-pulse" />
            <h3 className="text-lg font-medium">Analyzing your statement...</h3>
            <p className="text-muted-foreground mt-2">
              Extracting fields and detecting patterns
            </p>
            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              This may take a few seconds
            </div>
          </div>
        );

      case 'mapping':
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Map the extracted fields to the system fields. We've suggested some mappings based on the column names.
            </p>
            {extraction?.extractedFields && (
              <FieldMapper
                extractedFields={extraction.extractedFields}
                mappings={mappings}
                onChange={handleMappingsChange}
              />
            )}
            <div className="flex justify-between pt-4">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleContinueToConfirm} disabled={saveMappingsMutation.isPending}>
                {saveMappingsMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    Continue
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </div>
        );

      case 'confirm':
        return (
          <div className="space-y-4">
            <div className="grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="templateName">Template Name</Label>
                <Input
                  id="templateName"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="e.g., HDFC Credit Card Statement"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="institution">Institution</Label>
                <Select value={institution} onValueChange={setInstitution}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select institution" />
                  </SelectTrigger>
                  <SelectContent>
                    {INSTITUTIONS.map((inst) => (
                      <SelectItem key={inst.value} value={inst.value}>
                        {inst.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="statementType">Statement Type</Label>
                <Select value={statementType} onValueChange={setStatementType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATEMENT_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Detection Patterns</Label>
                <div className="flex flex-wrap gap-2">
                  {textPatterns.map((pattern, idx) => (
                    <Badge key={idx} variant="secondary">
                      {pattern}
                    </Badge>
                  ))}
                  {textPatterns.length === 0 && (
                    <span className="text-sm text-muted-foreground">
                      No patterns detected
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  These patterns will be used to automatically recognize similar statements
                </p>
              </div>
            </div>

            <div className="flex justify-between pt-4">
              <Button variant="outline" onClick={() => setStep('mapping')}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button
                onClick={handleComplete}
                disabled={!templateName || !institution || completeMutation.isPending}
              >
                {completeMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    Save Template
                    <CheckCircle className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </div>
        );

      case 'complete':
        return (
          <div className="py-8 text-center">
            <CheckCircle className="h-16 w-16 mx-auto mb-4 text-green-600" />
            <h3 className="text-lg font-medium">Template Learned!</h3>
            <p className="text-muted-foreground mt-2">
              I'm now ready to process {templateName} statements automatically.
            </p>
            <Button className="mt-6" onClick={onComplete}>
              Done
            </Button>
          </div>
        );

      case 'error':
        return (
          <div className="py-8 text-center">
            <AlertCircle className="h-16 w-16 mx-auto mb-4 text-destructive" />
            <h3 className="text-lg font-medium">Learning Failed</h3>
            <p className="text-muted-foreground mt-2">{error}</p>
            <div className="mt-6 flex justify-center gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => setStep('upload')}>
                Try Again
              </Button>
            </div>
          </div>
        );
    }
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            {step === 'complete' ? 'Learning Complete' : 'Learn Statement Format'}
          </DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'Upload a sample statement to teach the system its format'}
            {step === 'extracting' && 'Analyzing the statement structure...'}
            {step === 'mapping' && 'Map the extracted fields to system fields'}
            {step === 'confirm' && 'Confirm the template details'}
          </DialogDescription>
        </DialogHeader>
        {renderStep()}
      </DialogContent>
    </Dialog>
  );
}

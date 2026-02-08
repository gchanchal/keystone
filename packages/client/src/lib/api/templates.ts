import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// Types
export interface LearnedTemplate {
  id: string;
  userId: string;
  name: string;
  institution: string;
  statementType: 'bank_statement' | 'credit_card' | 'loan' | 'investment' | 'other';
  fileType: 'pdf' | 'xlsx' | 'csv';
  detectionPatterns: {
    textPatterns: string[];
    filenamePatterns?: string[];
  };
  fieldMappings: Record<string, { source: string; format?: string }>;
  sampleHeaders: string[] | null;
  sampleRows: any[][] | null;
  isActive: number;
  confidenceScore: number;
  timesUsed: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LearningSession {
  id: string;
  userId: string;
  templateId: string | null;
  status: 'extracting' | 'mapping' | 'completed' | 'failed';
  filename: string;
  filePath: string;
  fileType: string | null;
  extractedFields: {
    headers: string[];
    columns: {
      index: number;
      name: string;
      type: 'text' | 'date' | 'amount' | 'number' | 'unknown';
      sampleValues: string[];
    }[];
    sampleRows: any[][];
    rowCount: number;
    headerRowIndex: number;
  } | null;
  suggestedMappings: Record<string, { source: string; format?: string }> | null;
  finalMappings: Record<string, { source: string; format?: string }> | null;
  detectedPatterns: {
    textPatterns: string[];
    filenamePatterns: string[];
  } | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExtractionResult {
  status: 'extracting' | 'mapping' | 'completed' | 'failed';
  message?: string;
  error?: string;
  extractedFields?: LearningSession['extractedFields'];
  suggestedMappings?: LearningSession['suggestedMappings'];
  detectedPatterns?: LearningSession['detectedPatterns'];
}

export interface TemplateCheckResult {
  matched: boolean;
  template?: LearnedTemplate;
  confidence?: 'high' | 'medium' | 'low';
}

// System field definitions
export const SYSTEM_FIELDS = {
  date: { label: 'Date', type: 'date', required: true },
  valueDate: { label: 'Value Date', type: 'date', required: false },
  narration: { label: 'Narration/Description', type: 'text', required: true },
  reference: { label: 'Reference/Cheque No', type: 'text', required: false },
  withdrawal: { label: 'Withdrawal/Debit', type: 'amount', required: false },
  deposit: { label: 'Deposit/Credit', type: 'amount', required: false },
  amount: { label: 'Amount', type: 'amount', required: false },
  balance: { label: 'Balance', type: 'amount', required: false },
  transactionType: { label: 'Transaction Type', type: 'text', required: false },
  category: { label: 'Category', type: 'text', required: false },
  merchant: { label: 'Merchant', type: 'text', required: false },
  cardNumber: { label: 'Card Number', type: 'text', required: false },
  ignore: { label: '(Ignore this field)', type: 'ignore', required: false },
} as const;

export type SystemFieldKey = keyof typeof SYSTEM_FIELDS;

// Templates API
export const templatesApi = {
  // Get all learned templates
  getAll: () =>
    api.get<LearnedTemplate[]>('/templates').then((r) => r.data),

  // Get single template
  getById: (id: string) =>
    api.get<LearnedTemplate>(`/templates/${id}`).then((r) => r.data),

  // Update template
  update: (id: string, data: Partial<{
    name: string;
    institution: string;
    statementType: string;
    fieldMappings: Record<string, any>;
    detectionPatterns: { textPatterns?: string[]; filenamePatterns?: string[] };
    isActive: boolean;
  }>) =>
    api.put<LearnedTemplate>(`/templates/${id}`, data).then((r) => r.data),

  // Delete template
  delete: (id: string) =>
    api.delete(`/templates/${id}`).then((r) => r.data),

  // Check if file matches a template
  check: (content?: string, filename?: string) =>
    api.post<TemplateCheckResult>('/templates/check', { content, filename }).then((r) => r.data),

  // Increment usage counter
  incrementUsage: (id: string) =>
    api.post(`/templates/${id}/increment-usage`).then((r) => r.data),
};

// Learning API
export const learnApi = {
  // Start learning session with file upload
  start: (file: File, password?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (password) {
      formData.append('password', password);
    }
    return api.post<{
      sessionId: string;
      status: string;
      filename: string;
      fileType: string;
    }>('/learn/start', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },

  // Get session status and data
  getSession: (sessionId: string) =>
    api.get<LearningSession>(`/learn/${sessionId}`).then((r) => r.data),

  // Get all sessions
  getSessions: () =>
    api.get<LearningSession[]>('/learn').then((r) => r.data),

  // Get extraction results (poll until ready)
  getExtraction: (sessionId: string) =>
    api.get<ExtractionResult>(`/learn/${sessionId}/extract`).then((r) => r.data),

  // Save user mappings
  saveMappings: (sessionId: string, mappings: Record<string, { source: string; format?: string }>) =>
    api.put(`/learn/${sessionId}/mappings`, { mappings }).then((r) => r.data),

  // Complete session and create template
  complete: (sessionId: string, data: {
    name: string;
    institution: string;
    statementType: 'bank_statement' | 'credit_card' | 'loan' | 'investment' | 'other';
    detectionPatterns: {
      textPatterns: string[];
      filenamePatterns?: string[];
    };
  }) =>
    api.post<{ success: boolean; template: LearnedTemplate }>(`/learn/${sessionId}/complete`, data).then((r) => r.data),

  // Cancel and delete session
  cancel: (sessionId: string) =>
    api.delete(`/learn/${sessionId}`).then((r) => r.data),
};

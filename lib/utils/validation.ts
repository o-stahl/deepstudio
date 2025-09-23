import { toast } from 'sonner';

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

export const validateProjectName = (name: string): ValidationResult => {
  if (!name.trim()) {
    return { isValid: false, error: 'Project name cannot be empty' };
  }
  
  if (name.length > 50) {
    return { isValid: false, error: 'Project name must be 50 characters or less' };
  }
  
  return { isValid: true };
};

export const validateProjectDescription = (description: string): ValidationResult => {
  if (description.length > 200) {
    return { isValid: false, error: 'Description must be 200 characters or less' };
  }
  
  return { isValid: true };
};

export const validateFileUpload = (file: File, sizeLimit: number = 10 * 1024 * 1024): ValidationResult => {
  const supportedTypes = ['text/', 'application/json', 'application/javascript', 'application/xml'];
  const isSupported = supportedTypes.some(type => file.type.startsWith(type)) || 
                     file.name.match(/\.(txt|html|css|js|ts|jsx|tsx|json|md|xml|svg|csv)$/i);
  
  if (!isSupported) {
    return { isValid: false, error: `File type not supported: ${file.name}` };
  }
  
  if (file.size > sizeLimit) {
    return { isValid: false, error: `File too large: ${file.name}. Maximum size is ${Math.round(sizeLimit / 1024 / 1024)}MB` };
  }
  
  return { isValid: true };
};

export const showValidationError = (result: ValidationResult): boolean => {
  if (!result.isValid && result.error) {
    toast.error(result.error);
    return false;
  }
  return true;
};

export const showSuccess = (message: string): void => {
  toast.success(message);
};

export const showError = (message: string): void => {
  toast.error(message);
};
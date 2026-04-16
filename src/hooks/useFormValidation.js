import { useState, useCallback } from 'react';

/**
 * Form validation hook.
 *
 * Rules format:
 * {
 *   fieldName: { required: 'הודעת שגיאה' },
 *   fieldName: { pattern: [/regex/, 'הודעת שגיאה'] },
 *   fieldName: { min: [10, 'מינימום 10 תווים'] },
 *   fieldName: { range: [1900, 2030, 'שנה לא תקינה'] },
 *   fieldName: { custom: [fn, 'הודעת שגיאה'] },  // fn(value) => true/false
 * }
 */
export default function useFormValidation() {
  const [errors, setErrors] = useState({});

  const validate = useCallback((data, rules) => {
    const newErrors = {};

    Object.entries(rules).forEach(([field, rule]) => {
      const value = data[field];
      const isEmpty = value === undefined || value === null || value === '' ||
        (Array.isArray(value) && value.length === 0);

      if (rule.required && isEmpty) {
        newErrors[field] = rule.required;
        return;
      }

      // Skip further checks if empty and not required
      if (isEmpty) return;

      if (rule.pattern) {
        const [regex, msg] = rule.pattern;
        const cleaned = typeof value === 'string' ? value.replace(/[-\s]/g, '') : String(value);
        if (!regex.test(cleaned)) {
          newErrors[field] = msg;
        }
      }

      if (rule.min) {
        const [minLen, msg] = rule.min;
        if (typeof value === 'string' && value.trim().length < minLen) {
          newErrors[field] = msg;
        }
      }

      if (rule.range) {
        const [min, max, msg] = rule.range;
        const num = Number(value);
        if (isNaN(num) || num < min || num > max) {
          newErrors[field] = msg;
        }
      }

      if (rule.custom) {
        const [fn, msg] = rule.custom;
        if (!fn(value, data)) {
          newErrors[field] = msg;
        }
      }
    });

    setErrors(newErrors);

    // Scroll to first error field
    if (Object.keys(newErrors).length > 0) {
      setTimeout(() => {
        const firstField = Object.keys(newErrors)[0];
        const el = document.querySelector(`[data-field="${firstField}"]`) ||
                   document.querySelector(`[name="${firstField}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }

    return Object.keys(newErrors).length === 0;
  }, []);

  const clearError = useCallback((field) => {
    setErrors(prev => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const clearAll = useCallback(() => setErrors({}), []);

  return { errors, validate, clearError, clearAll };
}

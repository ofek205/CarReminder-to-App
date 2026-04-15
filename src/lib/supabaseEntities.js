/**
 * Supabase data access layer — replaces base44.entities
 *
 * Usage:  import { db } from '@/lib/supabaseEntities';
 *         const rows = await db.vehicles.filter({ account_id: '...' });
 *         const created = await db.accounts.create({ name: '...' });
 */
import { supabase } from './supabase';

// ── Security helpers ──────────────────────────────────────────────────────
const VALID_KEY = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function validateFilterKeys(conditions) {
  for (const key of Object.keys(conditions)) {
    if (!VALID_KEY.test(key)) {
      throw new Error(`Invalid filter key: ${key}`);
    }
  }
}

/**
 * Sanitize a string value: strip ALL HTML tags, event handlers, entities, and control characters.
 * Prevents XSS via <script>, <img onerror=>, HTML entities, fullwidth Unicode, etc.
 */
function sanitizeString(value) {
  if (typeof value !== 'string') return value;
  let s = value;
  // 1. Decode HTML entities (&#60; → <, &#x3c; → <, &lt; → <)
  s = s.replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  s = s.replace(/&#(\d+);?/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
  s = s.replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&')
       .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'");
  // 2. Normalize fullwidth Unicode chars (＜ → <, ＞ → >)
  s = s.replace(/[\uFF1C\uFE64]/g, '<').replace(/[\uFF1E\uFE65]/g, '>');
  // 3. Strip ALL HTML tags (after entity decode)
  s = s.replace(/<[^>]*>/g, '');
  // 4. Strip event handlers that might survive (even without tags)
  s = s.replace(/on\w+\s*=/gi, '');
  // 5. Strip javascript: protocol (with whitespace/tab tricks)
  s = s.replace(/j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:/gi, '');
  // 6. Strip control characters
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  return s.trim();
}

function sanitizeRow(row) {
  if (!row || typeof row !== 'object') throw new Error('Invalid row data');
  const clean = {};
  for (const [key, value] of Object.entries(row)) {
    if (!VALID_KEY.test(key)) continue; // skip invalid keys
    if (typeof value === 'string') {
      clean[key] = sanitizeString(value);
    } else if (Array.isArray(value)) {
      // Sanitize arrays (e.g., fire_extinguishers JSON)
      clean[key] = value.map(item =>
        typeof item === 'string' ? sanitizeString(item)
        : (item && typeof item === 'object') ? Object.fromEntries(
            Object.entries(item).map(([k, v]) => [k, sanitizeString(v)])
          )
        : item
      );
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

function makeEntity(table) {
  return {
    /** Filter rows by exact-match conditions. Returns array of rows. */
    async filter(conditions = {}) {
      validateFilterKeys(conditions);
      let query = supabase.from(table).select('*');
      for (const [key, value] of Object.entries(conditions)) {
        query = query.eq(key, value);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },

    /** Create a new row. Returns the created row. */
    async create(row) {
      const { data, error } = await supabase.from(table).insert(sanitizeRow(row)).select().single();
      if (error) throw error;
      return data;
    },

    /** Update a row by id. Returns the updated row. */
    async update(id, changes) {
      if (!id) throw new Error('Update requires an id');
      const { data, error } = await supabase.from(table).update(sanitizeRow(changes)).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },

    /** Delete a row by id. */
    async delete(id) {
      if (!id) throw new Error('Delete requires an id');
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) throw error;
    },

    /** List all accessible rows. Returns array. */
    async list() {
      const { data, error } = await supabase.from(table).select('*');
      if (error) throw error;
      return data || [];
    },
  };
}

export const db = {
  accounts:        makeEntity('accounts'),
  account_members: makeEntity('account_members'),
  vehicles:        makeEntity('vehicles'),
  accidents:       makeEntity('accidents'),
  vessel_issues:   makeEntity('vessel_issues'),
  invites:            makeEntity('invites'),
  reminder_settings:  makeEntity('reminder_settings'),
  notification_log:   makeEntity('notification_log'),
  analytics:          makeEntity('anonymous_analytics'),
  cork_notes:         makeEntity('cork_notes'),
  user_profiles:      makeEntity('user_profiles'),
  documents:          makeEntity('documents'),
  community_posts:    makeEntity('community_posts'),
  community_comments: makeEntity('community_comments'),
  community_notifications: makeEntity('community_notifications'),
  community_likes:    makeEntity('community_likes'),
  community_reactions: makeEntity('community_reactions'),
  community_saved:    makeEntity('community_saved'),
  community_comment_likes: makeEntity('community_comment_likes'),
  maintenance_logs:   makeEntity('maintenance_logs'),
};

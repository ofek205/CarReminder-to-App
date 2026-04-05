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

function sanitizeRow(row) {
  if (!row || typeof row !== 'object') throw new Error('Invalid row data');
  const clean = {};
  for (const [key, value] of Object.entries(row)) {
    if (!VALID_KEY.test(key)) continue; // skip invalid keys
    // Strip any <script> tags from string values
    if (typeof value === 'string') {
      clean[key] = value.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
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
};

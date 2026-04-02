/**
 * Supabase data access layer — replaces base44.entities
 *
 * Usage:  import { db } from '@/lib/supabaseEntities';
 *         const rows = await db.vehicles.filter({ account_id: '...' });
 *         const created = await db.accounts.create({ name: '...' });
 */
import { supabase } from './supabase';

function makeEntity(table) {
  return {
    /** Filter rows by exact-match conditions. Returns array of rows. */
    async filter(conditions = {}) {
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
      const { data, error } = await supabase.from(table).insert(row).select().single();
      if (error) throw error;
      return data;
    },

    /** Update a row by id. Returns the updated row. */
    async update(id, changes) {
      const { data, error } = await supabase.from(table).update(changes).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },

    /** Delete a row by id. */
    async delete(id) {
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
};

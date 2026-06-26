import React, { useState } from 'react';
import { Edit3, Send, Bell, Mail, Clock, AlertCircle, Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useToggleNotification } from '@/hooks/useEmailAdmin';
import { toast } from 'sonner';
import { C } from '@/lib/designTokens';

// Map category → visual (icon + color)
const CATEGORY_VISUAL = {
  transactional: { icon: Mail,       label: 'טרנזקציוני',  bg: C.infoBg, fg: C.infoDark },
  reminder:      { icon: Clock,      label: 'תזכורת',       bg: C.warnBg, fg: C.warnDark },
  system:        { icon: AlertCircle,label: 'מערכת',        bg: '#F3E8FF', fg: '#6B21A8' },
  auth:          { icon: Bell,       label: 'אימות',         bg: '#E0F7FA', fg: '#0E7490' },
  marketing:     { icon: Mail,       label: 'שיווק',         bg: '#FCE7F3', fg: '#9D174D' },
};

/**
 * NotificationTypeRow. a single row in the Notifications table.
 *
 * Shows: category badge · display name · description · status · actions.
 * Actions: enable/disable toggle, "edit template", "send test".
 *
 * The parent (EmailCenter) handles which dialog opens on click.
 */
export default function NotificationTypeRow({ notification, onEditTemplate, onSendTest, onBroadcast }) {
  const toggle = useToggleNotification();
  const [pending, setPending] = useState(false);

  const visual = CATEGORY_VISUAL[notification.category] || CATEGORY_VISUAL.transactional;
  const Icon = visual.icon;

  const handleToggle = async (checked) => {
    setPending(true);
    try {
      await toggle.mutateAsync({ key: notification.key, enabled: checked });
      toast.success(checked ? 'הופעל' : 'הושבת');
    } catch (e) {
      toast.error(`נכשל: ${e.message}`);
    } finally {
      setPending(false);
    }
  };

  return (
    <div dir="rtl"
      className="rounded-2xl p-4 mb-3 transition-all"
      style={{ background: '#FFFFFF', border: `1.5px solid ${C.gray200}`, boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
      <div className="flex items-center gap-4 flex-wrap">

        {/* Icon */}
        <div className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center"
          style={{ background: visual.bg }}>
          <Icon className="w-5 h-5" style={{ color: visual.fg }} />
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="font-bold text-sm" style={{ color: C.text }}>
              {notification.display_name}
            </h3>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: visual.bg, color: visual.fg }}>
              {visual.label}
            </span>
            {!notification.is_implemented && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: C.warnBg, color: C.warnDark }}>
                לא מיושם עדיין
              </span>
            )}
          </div>
          <p className="text-xs text-gray-600 leading-relaxed">
            {notification.description}
          </p>
          <p className="text-[10px] text-gray-400 mt-1 font-mono" dir="ltr">
            {notification.key}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-2 pl-3 border-l border-gray-200">
            <span className="text-xs text-gray-600">
              {!notification.is_implemented ? 'לא ממומש' : notification.enabled ? 'פעיל' : 'כבוי'}
            </span>
            {/* Block enabling a type with no working dispatch path (e.g.
                reminder_license / reminder_maintenance have no candidate
                clause — enabling them would send nothing, silently). The
                "לא מיושם עדיין" badge above explains why it's locked. */}
            <Switch
              checked={notification.enabled}
              onCheckedChange={handleToggle}
              disabled={pending || !notification.is_implemented}
              title={!notification.is_implemented ? 'סוג זה עדיין לא ממומש לשליחה' : undefined}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 rounded-xl h-9"
            onClick={() => onEditTemplate(notification)}>
            <Edit3 className="w-3.5 h-3.5" />
            תבנית
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 rounded-xl h-9"
            onClick={() => onSendTest(notification)}
            disabled={!notification.enabled}>
            <Send className="w-3.5 h-3.5" />
            בדיקה
          </Button>
          {notification.trigger_type === 'manual' && onBroadcast && (
            <Button
              size="sm"
              className="gap-1.5 rounded-xl h-9"
              onClick={() => onBroadcast(notification)}
              disabled={!notification.enabled}
              style={{ background: C.primary, color: 'white' }}>
              <Megaphone className="w-3.5 h-3.5" />
              שלח לכולם
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

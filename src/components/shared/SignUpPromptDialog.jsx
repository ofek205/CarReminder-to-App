import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Shield, UserPlus, CloudUpload } from "lucide-react";
import { base44 } from '@/api/base44Client';

export default function SignUpPromptDialog({ open, onClose, reason }) {
  const handleLogin = () => {
    base44.auth.redirectToLogin(window.location.href);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-center text-gray-900">שמור את הנתונים שלך</DialogTitle>
        </DialogHeader>
        <div className="text-center space-y-5 py-2">
          <div className="w-16 h-16 bg-amber-50 border border-amber-100 rounded-2xl flex items-center justify-center mx-auto">
            <CloudUpload className="h-8 w-8 text-amber-600" />
          </div>

          <div className="space-y-2">
            <p className="text-gray-700 text-sm font-medium">
              {reason || 'כדי לשמור נתונים באופן קבוע'}
            </p>
            <p className="text-gray-500 text-xs">
              הירשם בחינם - הנתונים הזמניים שלך יועברו אוטומטית לחשבון.
            </p>
          </div>

          <div className="space-y-2">
            <Button
              className="w-full bg-[#2D5233] hover:bg-[#1E3D24] text-white gap-2"
              onClick={handleLogin}
            >
              <UserPlus className="h-4 w-4" />
              הירשם / התחבר בחינם
            </Button>
            <Button variant="ghost" className="w-full text-gray-400 text-sm" onClick={onClose}>
              המשך ללא הרשמה
            </Button>
          </div>

          <div className="flex items-center gap-2 justify-center text-xs text-gray-400">
            <Shield className="h-3 w-3" />
            <span>הנתונים מאובטחים ומוצפנים</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Share2 } from "lucide-react";

export default function IOSInstallModal({ open, onClose }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm text-right" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-gray-900">הוספה למסך הבית</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2 text-sm text-gray-700">
          <p>כדי להוסיף את האפליקציה למסך הבית:</p>
          <ol className="space-y-2 list-decimal list-inside">
            <li className="flex items-center gap-2">
              <span>לחץ על כפתור</span>
              <Share2 className="h-4 w-4 text-blue-500 inline shrink-0" />
              <span className="font-medium">Share</span>
            </li>
            <li>בחר <span className="font-medium">"Add to Home Screen"</span></li>
            <li>לחץ <span className="font-medium">Add</span></li>
          </ol>
        </div>
        <Button onClick={onClose} className="w-full bg-[#2D5233] hover:bg-[#1E3D24] text-white">
          הבנתי
        </Button>
      </DialogContent>
    </Dialog>
  );
}
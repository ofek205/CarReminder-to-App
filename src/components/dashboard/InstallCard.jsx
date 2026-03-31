import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Smartphone } from "lucide-react";
import usePWAInstall from "../shared/usePWAInstall";
import IOSInstallModal from "../shared/IOSInstallModal";
import { isNative } from "@/lib/capacitor";

export default function InstallCard() {
  // Don't show install CTA inside native app
  if (isNative) return null;
  const { install } = usePWAInstall();
  const [showIOSModal, setShowIOSModal] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    async function check() {
      try {
        const user = await base44.auth.me();
        if (!user) return;
        const snoozed = user.install_cta_snoozed_until;
        if (snoozed && new Date(snoozed) > new Date()) setHidden(true);
      } catch (e) {}
    }
    check();
  }, []);

  const handleInstall = async () => {
    const installed = await install();
    if (!installed) setShowIOSModal(true);
  };

  if (hidden) return null;

  return (
    <>
      <Card className="p-4 border border-green-200 bg-green-50 flex items-center justify-between gap-4 mt-4" dir="rtl">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-green-600 flex items-center justify-center shrink-0">
            <Smartphone className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="font-semibold text-gray-900 text-sm">הוסף כאפליקציה</p>
            <p className="text-xs text-gray-500">פותח מהר יותר ונראה כמו אפליקציה אמיתית</p>
          </div>
        </div>
        <Button
          size="sm"
          onClick={handleInstall}
          className="bg-green-600 hover:bg-green-700 text-white shrink-0"
        >
          📲 התקן
        </Button>
      </Card>

      <IOSInstallModal open={showIOSModal} onClose={() => setShowIOSModal(false)} />
    </>
  );
}
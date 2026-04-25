import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { useFontScale } from "./FontScaleProvider";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger } from
"@/components/ui/popover";

export default function FontScaleControls() {
  const { fontScale, applyScale } = useFontScale();
  const [tempScale, setTempScale] = useState(fontScale);
  const [open, setOpen] = useState(false);

  const FONT_SCALES = [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5];

  const handleIncrease = () => {
    const currentIndex = FONT_SCALES.indexOf(tempScale);
    if (currentIndex < FONT_SCALES.length - 1) {
      setTempScale(FONT_SCALES[currentIndex + 1]);
    }
  };

  const handleDecrease = () => {
    const currentIndex = FONT_SCALES.indexOf(tempScale);
    if (currentIndex > 0) {
      setTempScale(FONT_SCALES[currentIndex - 1]);
    }
  };

  const handleReset = () => setTempScale(1.0);

  const handleApply = async () => {
    await applyScale(tempScale);
    setOpen(false);
    toast.success('גודל טקסט עודכן בהצלחה');
  };

  // Sync tempScale when popover opens
  const handleOpenChange = (val) => {
    if (val) setTempScale(fontScale);
    setOpen(val);
  };

  const canIncrease = FONT_SCALES.indexOf(tempScale) < FONT_SCALES.length - 1;
  const canDecrease = FONT_SCALES.indexOf(tempScale) > 0;
  const tempPercentage = Math.round(tempScale * 100);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          title="גודל טקסט"
          className="bg-slate-300 text-sm font-bold rounded-2xl inline-flex items-center justify-center gap-1 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-9 px-2"
        >
          <span className="text-base leading-none">Aa</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-4" align="end">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm text-gray-900">גודל טקסט</h4>
            <span className="text-xs text-gray-500">{tempPercentage}%</span>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDecrease}
              disabled={!canDecrease}
              className="flex-1 font-semibold">

              A-
            </Button>
            
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={tempScale === 1.0}
              className="px-2">

              <RotateCcw className="h-4 w-4" />
            </Button>
            
            <Button
              variant="outline"
              size="sm"
              onClick={handleIncrease}
              disabled={!canIncrease}
              className="flex-1 font-semibold">

              A+
            </Button>
          </div>

          <Button
            onClick={handleApply}
            className="w-full bg-[#2D5233] hover:bg-[#1E3D24] text-white">

            החל
          </Button>
          
          <div className="text-xs text-gray-500 text-center">
            להקל על קריאת הטקסט
          </div>
        </div>
      </PopoverContent>
    </Popover>);

}
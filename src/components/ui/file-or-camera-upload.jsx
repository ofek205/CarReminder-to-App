import { Upload, Camera, Loader2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * FileOrCameraUpload
 * Two side-by-side buttons: file/gallery picker + direct camera capture.
 *
 * Props:
 *   accept      – accept string for the file picker (e.g. "image/*,.pdf")
 *   onChange    – file input change handler (same for both inputs)
 *   multiple    – allow selecting multiple files (file picker only)
 *   disabled    – disable both inputs
 *   uploading   – show spinner / disable during upload
 *   label       – label for the file-picker button (default: "העלה קובץ")
 *   className   – extra classes on the wrapper div
 */
export default function FileOrCameraUpload({
  accept,
  onChange,
  multiple,
  disabled,
  uploading,
  label = 'העלה קובץ',
  className,
}) {
  const isDisabled = disabled || uploading;

  return (
    <div className={cn("flex gap-2", className)}>
      {/* ── File / gallery picker ── */}
      <label
        className={cn(
          buttonVariants({ variant: "outline" }),
          "flex-1 cursor-pointer gap-2 justify-center",
          isDisabled && "opacity-50 pointer-events-none"
        )}
      >
        <input
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={onChange}
          disabled={isDisabled}
        />
        {uploading
          ? <Loader2 className="h-4 w-4 animate-spin" />
          : <Upload className="h-4 w-4" />}
        {uploading ? 'מעלה...' : label}
      </label>

      {/* ── Camera capture ── */}
      <label
        className={cn(
          buttonVariants({ variant: "outline" }),
          "cursor-pointer gap-1.5 px-3 justify-center shrink-0 border-[#2D5233] text-[#2D5233] hover:bg-[#FDF6F0]",
          isDisabled && "opacity-50 pointer-events-none"
        )}
        aria-label="צלם מסמך"
      >
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onChange}
          disabled={isDisabled}
        />
        <Camera className="h-4 w-4" />
        <span className="text-xs">צלם</span>
      </label>
    </div>
  );
}

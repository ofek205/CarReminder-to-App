import { Upload, Camera, Loader2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isNative, takePhoto, pickImage, hapticFeedback } from "@/lib/capacitor";
import { toast } from "sonner";

/**
 * FileOrCameraUpload
 * Two side-by-side buttons: file/gallery picker + direct camera capture.
 * On native (Capacitor) uses the Camera plugin; on web falls back to <input>.
 *
 * Props:
 *   accept      – accept string for the file picker (e.g. "image/*,.pdf")
 *   onChange    – file input change handler (same for both inputs)
 *   multiple    – allow selecting multiple files (file picker only, web)
 *   disabled    – disable both inputs
 *   uploading   – show spinner / disable during upload
 *   label       – label for the file-picker button (default: "העלה קובץ")
 *   className   – extra classes on the wrapper div
 */

/** Convert a data URL back into a File so onChange handlers don't need to know. */
function dataUrlToFile(dataUrl, filename = 'camera.jpg') {
  const arr = dataUrl.split(',');
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new File([u8arr], filename, { type: mime });
}

async function invokeNativeAndEmit(source, onChange) {
  try {
    hapticFeedback('light');
    const result = source === 'CAMERA' ? await takePhoto('CAMERA') : await pickImage();
    if (!result?.dataUrl) return;
    const file = dataUrlToFile(result.dataUrl, `capture-${Date.now()}.${result.format || 'jpg'}`);
    // Fake a change event so existing handlers keep working
    onChange?.({ target: { files: [file], value: '' }, preventDefault: () => {}, stopPropagation: () => {} });
  } catch (e) {
    console.warn('Native capture error:', e);
    toast.error('שגיאה בפתיחת המצלמה');
  }
}

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

  // Native mode: buttons instead of file inputs
  if (isNative) {
    return (
      <div className={cn("flex gap-2", className)}>
        <button
          type="button"
          disabled={isDisabled}
          onClick={() => invokeNativeAndEmit('PHOTOS', onChange)}
          aria-label={label}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "flex-1 gap-2 justify-center",
            isDisabled && "opacity-50 pointer-events-none"
          )}>
          {uploading
            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            : <Upload className="h-4 w-4" aria-hidden="true" />}
          {uploading ? 'מעלה...' : label}
        </button>
        <button
          type="button"
          disabled={isDisabled}
          onClick={() => invokeNativeAndEmit('CAMERA', onChange)}
          aria-label="צלם מסמך"
          className={cn(
            buttonVariants({ variant: "outline" }),
            "gap-1.5 px-3 justify-center shrink-0 border-[#2D5233] text-[#2D5233] hover:bg-[#FDF6F0]",
            isDisabled && "opacity-50 pointer-events-none"
          )}>
          <Camera className="h-4 w-4" aria-hidden="true" />
          <span className="text-xs">צלם</span>
        </button>
      </div>
    );
  }

  // Web fallback — original <input type=file> behaviour
  return (
    <div className={cn("flex gap-2", className)}>
      <label
        className={cn(
          buttonVariants({ variant: "outline" }),
          "flex-1 cursor-pointer gap-2 justify-center",
          isDisabled && "opacity-50 pointer-events-none"
        )}>
        <input
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={onChange}
          disabled={isDisabled}
        />
        {uploading
          ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          : <Upload className="h-4 w-4" aria-hidden="true" />}
        {uploading ? 'מעלה...' : label}
      </label>

      <label
        className={cn(
          buttonVariants({ variant: "outline" }),
          "cursor-pointer gap-1.5 px-3 justify-center shrink-0 border-[#2D5233] text-[#2D5233] hover:bg-[#FDF6F0]",
          isDisabled && "opacity-50 pointer-events-none"
        )}
        aria-label="צלם מסמך">
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onChange}
          disabled={isDisabled}
        />
        <Camera className="h-4 w-4" aria-hidden="true" />
        <span className="text-xs">צלם</span>
      </label>
    </div>
  );
}

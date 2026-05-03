/**
 * VehicleImage — displays a vehicle's photo with automatic signed-URL refresh.
 *
 * Why a component (and not just `<img src={vehicle.vehicle_photo}>`)?
 *   - Sprint A.B-2 moved vehicle photos from base64-in-DB to Supabase Storage.
 *     Storage URLs are signed and expire after 7 days. The DB stores BOTH
 *     `vehicle_photo` (the most recently signed URL, written on save) AND
 *     `vehicle_photo_storage_path` (the durable Storage path).
 *   - On any read, we want a fresh URL — otherwise users who edited a vehicle
 *     >7 days ago would see broken images. Calling `useSignedUrl` directly at
 *     each read site is impossible because most sites render photos inside a
 *     `vehicles.map(...)` loop (hooks can't run inside callbacks). This
 *     component is the canonical way to render a vehicle photo anywhere.
 *
 * Backward compatibility:
 *   - Legacy rows without `vehicle_photo_storage_path` still have a base64
 *     data: URL or an HTTPS URL in `vehicle_photo`. The fallback path inside
 *     `useSignedUrl` handles those — the hook returns the fallback when no
 *     storage_path is available.
 *
 * Conditional rendering:
 *   - For "show photo OR placeholder", use the `hasVehiclePhoto` helper
 *     exported alongside this component:
 *
 *       {hasVehiclePhoto(v)
 *         ? <VehicleImage vehicle={v} alt={name} className="..." />
 *         : <Placeholder />}
 */
import useSignedUrl from '@/hooks/useSignedUrl';

/**
 * Returns true when the vehicle has either a persisted URL or a storage_path
 * — i.e. when there's something for VehicleImage to render. Use this for
 * conditional rendering at every photo-or-placeholder site so we don't drift
 * out of sync with the actual VehicleImage URL-resolution logic.
 */
export function hasVehiclePhoto(vehicle) {
  return !!(vehicle?.vehicle_photo || vehicle?.vehicle_photo_storage_path);
}

export default function VehicleImage({
  vehicle,
  alt = '',
  className,
  ...imgProps
}) {
  const { url } = useSignedUrl(vehicle?.vehicle_photo_storage_path, {
    fallback: vehicle?.vehicle_photo,
  });

  // No photo at all → render nothing. Call sites should branch on
  // `hasVehiclePhoto(vehicle)` to decide between this and a placeholder
  // (we don't bake one in here because every screen has its own
  // placeholder geometry / iconography).
  if (!url) return null;

  return (
    <img
      src={url}
      alt={alt}
      className={className}
      {...imgProps}
    />
  );
}

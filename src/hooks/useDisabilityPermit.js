import { useQuery } from '@tanstack/react-query';

const RESOURCE_ID = 'c8b9f9c8-4612-4068-934f-d4acd2e3c06e';
const API_URL = 'https://data.gov.il/api/3/action/datastore_search';

function normalizePlate(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  return parseInt(digits, 10);
}

async function fetchPermit(plateNumber) {
  const url = `${API_URL}?resource_id=${RESOURCE_ID}&filters=${encodeURIComponent(JSON.stringify({ 'MISPAR RECHEV': plateNumber }))}&limit=1`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.success || !json.result?.total) return null;
    const rec = json.result.records[0];
    return {
      type: rec['SUG TAV'] === 2 ? 'temporary' : 'permanent',
      issueDate: rec['TAARICH HAFAKAT TAG'] || null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export default function useDisabilityPermit(licensePlate, { enabled = true } = {}) {
  const plateNumber = normalizePlate(licensePlate);

  return useQuery({
    queryKey: ['disability-permit', plateNumber],
    queryFn: () => fetchPermit(plateNumber),
    enabled: enabled && plateNumber !== null,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
    retryDelay: 1000,
  });
}

export type DistanceUnit = 'm' | 'km' | 'mi';

export interface DistanceValue {
  value: number;
  unit: DistanceUnit;
  meters: number;
}

export function haversineMeters(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * sinLng * sinLng;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function preferredDistanceUnit(params: {
  measurementSystem?: 'metric' | 'imperial' | null;
  countryDistanceUnit?: string | null;
}): DistanceUnit {
  if (params.countryDistanceUnit === 'mi' || params.countryDistanceUnit === 'mile') return 'mi';
  if (params.measurementSystem === 'imperial') return 'mi';
  return 'km';
}

export function formatDistance(meters: number, unit: DistanceUnit = 'km'): DistanceValue {
  if (unit === 'm') {
    return { value: Math.round(meters), unit: 'm', meters };
  }
  if (unit === 'mi') {
    return { value: Number((meters / 1609.344).toFixed(meters < 1609 ? 2 : 1)), unit: 'mi', meters };
  }
  if (meters < 1000) {
    return { value: Math.round(meters), unit: 'm', meters };
  }
  return { value: Number((meters / 1000).toFixed(meters < 10_000 ? 1 : 0)), unit: 'km', meters };
}

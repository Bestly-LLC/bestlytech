/** What Home Assistant really has, as `recipes_ha_status()` reports it from the Pi's device list. Drives the two toggles that
 *  depend on Home Assistant things: the Cooking lights scene and "open cook mode when you walk into the kitchen". */
export interface HaStatus {
  catalog: boolean;
  fresh: boolean;
  catalog_age_min?: number;
  scene_cooking: boolean;
  room_sensor: boolean;
  room_exists?: boolean;
  kitchen_sensor_exists?: boolean;
  kitchen_sensor_online?: boolean;
  settings?: { lights?: boolean; kitchen_auto?: boolean };
}

export interface HaToggleState { available: boolean; why: string | null }

const NOT_YET = "Not available yet: ";

/** Why the toggle is off, in plain words, or null when it can be used. Missing status (not loaded, or the call failed) counts as unavailable. */
export function lightsState(ha: HaStatus | null | undefined): HaToggleState {
  if (!ha) return { available: false, why: NOT_YET + "Home Assistant did not answer." };
  if (!ha.catalog) return { available: false, why: NOT_YET + "Home Assistant has not shared its device list yet." };
  if (!ha.fresh) return { available: false, why: NOT_YET + "Home Assistant has not reported in lately." };
  if (!ha.scene_cooking) return { available: false, why: NOT_YET + "Home Assistant has no Cooking scene." };
  return { available: true, why: null };
}

export function walkInState(ha: HaStatus | null | undefined): HaToggleState {
  if (!ha) return { available: false, why: NOT_YET + "Home Assistant did not answer." };
  if (!ha.catalog) return { available: false, why: NOT_YET + "Home Assistant has not shared its device list yet." };
  if (!ha.fresh) return { available: false, why: NOT_YET + "Home Assistant has not reported in lately." };
  if (!ha.room_exists) return { available: false, why: NOT_YET + "Home Assistant has no room sensor." };
  if (ha.kitchen_sensor_exists === false) return { available: false, why: NOT_YET + "Home Assistant has no Kitchen presence sensor." };
  if (!ha.kitchen_sensor_online) return { available: false, why: NOT_YET + "the Kitchen presence sensor is offline." };
  return { available: !!ha.room_sensor, why: ha.room_sensor ? null : NOT_YET + "the room sensor reports unknown." };
}

/** True when the room sensor says the kitchen (the sensor reports Bermuda area names such as Kitchen or Desk). */
export const isKitchen = (state: unknown) => typeof state === "string" && state.trim().toLowerCase() === "kitchen";

import { defineTunables } from './dev/tuning';

/**
 * Player-facing settings (what a future options menu will edit). Separate from feel tunables:
 * these are personal preference, not game design. Persisted like tunables (dev panel "settings").
 */
export const SETTINGS = defineTunables(
  'settings',
  {
    /** Source-engine style: radians per pixel = sensitivity * 0.022°. */
    sensitivity: 2.5,
    /** Multiplier on mouse speed while aiming (MW "ADS sensitivity multiplier"). Default: a slight cut. */
    adsSensitivity: 0.9,
    /**
     * Also scale ADS sensitivity by the zoom so on-screen speed stays consistent (MW "relative").
     * Off by default: stacked with the multiplier it cut AR aim speed ~37%, which felt sluggish.
     */
    adsRelative: false,
    fov: 90,
    invertY: false,
    sprintToggle: true,
    crouchToggle: true,
    volume: 0.8,
  },
  {
    sensitivity: [0.1, 10, 0.05],
    adsSensitivity: [0.2, 2, 0.01],
    fov: [60, 120, 1],
    volume: [0, 1, 0.01],
  },
);

export const FRAME_PRESETS = {
  desktop: { label: 'Desktop', width: 1440, height: 1024 },
  laptop: { label: 'Laptop', width: 1280, height: 800 },
  tablet: { label: 'Tablet', width: 834, height: 1194 },
  mobile: { label: 'Mobile', width: 390, height: 844 },
  custom: { label: 'Custom', width: 0, height: 0 },
} as const;

export type FramePresetKey = keyof typeof FRAME_PRESETS;

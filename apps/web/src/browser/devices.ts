import type { DeviceOrientation, DevicePresetId } from '../state/ui-store'

export interface DevicePreset {
  id: DevicePresetId
  name: string
  width: number
  height: number
  deviceScaleFactor: number
  mobile: boolean
  /** 是否允许横竖屏切换 */
  rotatable: boolean
}

export const DEVICE_PRESETS: DevicePreset[] = [
  {
    id: 'responsive',
    name: '自适应',
    width: 0,
    height: 0,
    deviceScaleFactor: 1,
    mobile: false,
    rotatable: false,
  },
  {
    id: 'desktop-1440',
    name: 'Desktop',
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
    rotatable: false,
  },
  {
    id: 'laptop-1280',
    name: 'Laptop',
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
    rotatable: false,
  },
  {
    id: 'tablet-1024',
    name: 'Tablet',
    width: 1024,
    height: 768,
    deviceScaleFactor: 2,
    mobile: true,
    rotatable: true,
  },
  {
    id: 'iphone-14',
    name: 'iPhone 14',
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
    rotatable: true,
  },
  {
    id: 'android-412',
    name: 'Android',
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625,
    mobile: true,
    rotatable: true,
  },
]

export function getDevicePreset(id: DevicePresetId): DevicePreset {
  return DEVICE_PRESETS.find((p) => p.id === id) ?? DEVICE_PRESETS[0]
}

/** 应用横竖屏后的逻辑尺寸 */
export function deviceSize(
  preset: DevicePreset,
  orientation: DeviceOrientation,
): { width: number; height: number } {
  if (preset.rotatable && orientation === 'landscape') {
    return { width: preset.height, height: preset.width }
  }
  return { width: preset.width, height: preset.height }
}

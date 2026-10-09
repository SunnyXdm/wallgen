import { Monitor, Ruler, Smartphone, Tablet } from "lucide-react"
import type { DeviceKind } from "./output"

export const KIND_ICON: Record<DeviceKind, typeof Smartphone> = {
  phone: Smartphone,
  desktop: Monitor,
  tablet: Tablet,
  custom: Ruler,
}

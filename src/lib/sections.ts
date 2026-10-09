export const SECTIONS = [
  { id: "looks", label: "Looks" },
  { id: "scene", label: "Scene" },
  { id: "color", label: "Color" },
  { id: "texture", label: "Texture" },
] as const
export type SectionId = (typeof SECTIONS)[number]["id"]

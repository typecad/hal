export function accessorGetterName(prop: string): string {
  return `get${prop.charAt(0).toUpperCase()}${prop.slice(1)}`;
}

export function accessorSetterName(prop: string): string {
  return `set${prop.charAt(0).toUpperCase()}${prop.slice(1)}`;
}

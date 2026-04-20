import ts from "typescript";

const PRIMITIVE_CPP_TYPES = new Set([
  'int', 'float', 'double', 'bool', 'char', 'long', 'void',
  'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
  'int8_t', 'int16_t', 'int32_t', 'int64_t',
  'size_t', 'byte', 'word',
  'unsigned int', 'unsigned long', 'unsigned char',
  'signed int', 'signed long', 'signed char',
]);

export function isPrimitiveCppType(cppType: string): boolean {
  return PRIMITIVE_CPP_TYPES.has(cppType.trim());
}

export function renderFloatLiteral(value: string): string {
  if (value.includes('.') || value.includes('e') || value.includes('E')) {
    return value + 'f';
  }
  return value + '.0f';
}

export function extractRootAndChain(node: ts.Expression): { root: string; chain: string[] } | undefined {
  if (ts.isIdentifier(node)) {
    return { root: node.text, chain: [] };
  }
  if (ts.isPropertyAccessExpression(node)) {
    const inner = extractRootAndChain(node.expression);
    if (inner) {
      return { root: inner.root, chain: [...inner.chain, node.name.text] };
    }
  }
  return undefined;
}

export function accessorGetterName(prop: string): string {
  return `get${prop.charAt(0).toUpperCase()}${prop.slice(1)}`;
}

export function accessorSetterName(prop: string): string {
  return `set${prop.charAt(0).toUpperCase()}${prop.slice(1)}`;
}

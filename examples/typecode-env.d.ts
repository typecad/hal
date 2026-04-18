declare global {
  type Owned<T = any> = T;
  type Ref<T = any> = T;
  type MutRef<T = any> = T;

  // C-style explicit number types recognized by the transpiler
  type uint8_t = number;
  type int8_t = number;
  type uint16_t = number;
  type int16_t = number;
  type uint32_t = number;
  type int32_t = number;
  type size_t = number;
  type float = number;
  type double = number;
}

declare module '@typecode' {
  export * from '@typecode/board-arduino-uno';
}

export {};
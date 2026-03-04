// ---------------------------------------------------------------------------
// @typecode/board-native-uno — Native AVR platform strategy
//
// This board package uses the NativeAVRStrategy from @typecode/arch-avr-native
// to generate direct AVR register access instead of Arduino framework calls.
// ---------------------------------------------------------------------------

export { NativeAVRStrategy as BoardStrategy } from '@typecode/arch-avr-native';
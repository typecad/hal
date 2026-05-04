import { Owned } from '@typehal';

const buffer: Owned<Uint8Array> = new Uint8Array([1, 2, 3]);

// Ownership is transferred to 'movedBuffer'
const movedBuffer = buffer; 

// ERROR: 'buffer' was moved and cannot be used again. [ownership-use-after-move]
console.log(buffer[0]); 
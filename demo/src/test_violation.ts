import { Owned, Shared, Mutable } from '@typehal';

function demo(): void {
  let a: Owned = [1, 2, 3];
  let b = a;  // move
  console.log(a[0]);  // use-after-move
}
demo();

import { Owned, Shared, Mutable } from '@typehal';

function demo(): void {
  let a: Owned = [1, 2, 3];
  let b = a;
  let c = a;
}
demo();

// ---------------------------------------------------------------------------
// main.ts — bank ledger demo (cuttlefish demo #18).
//
// A small, idiomatic TypeScript program: a Bank keeps Accounts in an array and
// supports opening accounts, depositing, withdrawing, and reporting balances.
// The driver opens two accounts, runs a few everyday transactions, and prints
// the final ledger. Transpiled to C++ by cuttlefish (@typecad/framework-native).
//
// This is the *eighteenth* demo iteration. Like #15–#17 it is deliberately
// small and readable — real, everyday TypeScript — and is *not* a feature-
// exhaustion test. The source uses its natural idiomatic form throughout.
//
// Three transpilation gaps it surfaced are now FIXED in the transpiler and
// pinned by tests/packages/transpiler/demo-18-regressions.test.ts:
//   A — `Account | null` returned from a method and compared with `=== null`.
//   B — module-scope free functions (formatMoney/kindLabel) called from a
//       class method body in split mode.
//   C — struct-field interpolation inside a template literal in a class
//       method (snprintf format inference). See README.
// ---------------------------------------------------------------------------

// Account kinds. `const enum` so members are inlined (a plain `enum` is
// lint-gated in scaffolded projects — by design).
const enum Kind {
  Checking = 1,
  Savings = 2,
}

// A single account. Interface -> C++ struct. Cents are kept in a fixed-width
// int so there is no floating-point rounding in the ledger.
interface Account {
  id: int32_t;
  name: string;
  kind: Kind;
  cents: int32_t;
}

// Format an amount in cents as "D.CC" (e.g. 1234 -> "12.34"). A module-scope
// free function. (Finding B: this is now reachable from a class method body in
// split mode — the transpiler forward-declares it in the header.)
function formatMoney(cents: int32_t): string {
  const dollars: int32_t = cents / 100;
  const remainder: int32_t = cents % 100;
  // A leading zero for amounts under ten cents: "12.05" not "12.5".
  if (remainder < 10) {
    return `${dollars}.0${remainder}`;
  }
  return `${dollars}.${remainder}`;
}

// A short label for an account kind. Numeric switch with a default branch.
function kindLabel(kind: Kind): string {
  switch (kind) {
    case Kind.Checking:
      return 'checking';
    case Kind.Savings:
      return 'savings';
    default:
      return 'unknown';
  }
}

// A small in-memory bank. Class -> C++ class. Accounts live in a
// std::vector<Account>; the counter tracks the next free account id.
class Bank {
  private accounts: Account[] = [];
  private nextId: int32_t = 1;

  // Open an account with a starting balance of zero; returns the new id.
  open(name: string, kind: Kind): int32_t {
    const id: int32_t = this.nextId;
    this.nextId = this.nextId + 1;
    const a: Account = {
      id: id,
      name: name,
      kind: kind,
      cents: 0,
    };
    this.accounts.push(a);
    return id;
  }

  // Read the balance of an account by id, or -1 if it does not exist. Uses
  // `find()` (the natural nullable `Account | null` return) for the lookup —
  // this is a read-only use, so value-copy semantics are fine. Finding A: the
  // `a === null` check here is exercised and lowers correctly.
  balanceOf(id: int32_t): int32_t {
    const a: Account | null = this.find(id);
    if (a === null) {
      return -1;
    }
    return a.cents;
  }

  // Find an account by id, or null if it does not exist. The natural nullable
  // return: `Account | null`. (Finding A: callers compare the result with
  // `=== null`; the transpiler now resolves a struct value type to a
  // compile-time `false` instead of the invalid `struct == 0`.) Read-only —
  // see the note on `deposit` for why mutating methods use `indexOf` instead.
  private find(id: int32_t): Account | null {
    for (const a of this.accounts) {
      if (a.id === id) {
        return a;
      }
    }
    return null;
  }

  // Index of an account by id, or -1 if it does not exist. Mutating methods
  // (deposit/withdraw) use this rather than `find()` because a struct returned
  // from `find()` is a C++ *value copy* — mutating it would not write back to
  // the vector element (the same value-semantics limitation as Map.get(), see
  // SUPPORT_MATRIX §1.5). Mutating `this.accounts[i].cents` writes through.
  private indexOf(id: int32_t): int32_t {
    for (let i: int32_t = 0; i < this.accounts.length; i = i + 1) {
      if (this.accounts[i]!.id === id) {
        return i;
      }
    }
    return -1;
  }

  // Add cents to an account. Returns true on success, false if the id is bad.
  deposit(id: int32_t, cents: int32_t): boolean {
    const i: int32_t = this.indexOf(id);
    if (i < 0) {
      return false;
    }
    this.accounts[i]!.cents = this.accounts[i]!.cents + cents;
    return true;
  }

  // Subtract cents from an account, refusing to overdraft. Returns true on
  // success, false if the id is bad or there are not enough funds.
  withdraw(id: int32_t, cents: int32_t): boolean {
    const i: int32_t = this.indexOf(id);
    if (i < 0) {
      return false;
    }
    if (this.accounts[i]!.cents < cents) {
      return false;
    }
    this.accounts[i]!.cents = this.accounts[i]!.cents - cents;
    return true;
  }

  // The total held across all accounts. A plain accumulator loop.
  totalCents(): int32_t {
    let sum: int32_t = 0;
    for (const a of this.accounts) {
      sum = sum + a.cents;
    }
    return sum;
  }

  // Print the ledger, one line per account. (Finding B: the free functions
  // kindLabel/formatMoney are called from this class method body; Finding C:
  // the struct fields a.id/a.name are interpolated directly in the template
  // literal — both now lower correctly.)
  printAll(): void {
    for (const a of this.accounts) {
      console.log(`#${a.id} ${a.name} (${kindLabel(a.kind)}) ${formatMoney(a.cents)}`);
    }
  }
}

// Entry point.
function main(): void {
  const bank: Bank = new Bank();

  // Open two everyday accounts.
  const alice: int32_t = bank.open('Alice', Kind.Checking);
  const bob: int32_t = bank.open('Bob', Kind.Savings);

  // Run a few transactions. Plain idiomatic calls + boolean results.
  bank.deposit(alice, 5000);          // Alice starts with $50.00
  bank.deposit(bob, 12000);           // Bob starts with $120.00
  bank.withdraw(alice, 1800);         // Alice takes out $18.00
  const overdraft: boolean = bank.withdraw(bob, 999999);  // too much -> false
  bank.deposit(bob, 500);             // Bob adds $5.00

  // Report a couple of outcomes.
  console.log(`overdraft_refused=${overdraft}`);
  console.log(`alice=${formatMoney(bank.balanceOf(alice))}`);
  console.log(`bob=${formatMoney(bank.balanceOf(bob))}`);
  console.log(`total=${formatMoney(bank.totalCents())}`);
  console.log('---');
  bank.printAll();
  console.log('done');
}

main();

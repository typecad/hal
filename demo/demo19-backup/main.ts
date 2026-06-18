// ---------------------------------------------------------------------------
// main.ts — library book tracker demo (cuttlefish demo #19).
//
// A small, idiomatic TypeScript program: a Library keeps Books in an array and
// supports adding books, checking them out, returning them, and reporting how
// many are currently available. The driver stocks a tiny library, lends a
// couple of books out, returns one, and prints the final shelf. Transpiled to
// C++ by cuttlefish (@typecad/framework-native).
//
// This is the *nineteenth* demo iteration. Like #15–#18 it is deliberately
// small and readable — real, everyday TypeScript — and is *not* a feature-
// exhaustion test. The source uses its natural idiomatic form throughout.
// ---------------------------------------------------------------------------

// Lending state. `const enum` so members are inlined (a plain `enum` is
// lint-gated in scaffolded projects — by design).
const enum Status {
  Available = 0,
  OnLoan = 1,
}

// A single book. Interface -> C++ struct. The title is the natural lookup
// key for this small library; an int id also lets us count uniquely.
interface Book {
  id: int32_t;
  title: string;
  status: Status;
}

// A short label for a book's status. Numeric switch with a default branch.
// A module-scope free function.
function statusLabel(s: Status): string {
  switch (s) {
    case Status.Available:
      return 'available';
    case Status.OnLoan:
      return 'on loan';
    default:
      return 'unknown';
  }
}

// A tiny in-memory library. Class -> C++ class. Books live in a
// std::vector<Book>; the counter tracks the next free book id.
class Library {
  private books: Book[] = [];
  private nextId: int32_t = 1;

  // Add a book by title; it starts Available. Returns the assigned id.
  add(title: string): int32_t {
    const id: int32_t = this.nextId;
    this.nextId = this.nextId + 1;
    const b: Book = {
      id: id,
      title: title,
      status: Status.Available,
    };
    this.books.push(b);
    return id;
  }

  // Index of a book by title (case-sensitive), or -1 if not found. Mutating
  // methods (checkOut/returnBook) look up by index and mutate in place — a
  // struct returned from a helper would be a C++ value copy (see the note in
  // the bank-ledger demo #18 / SUPPORT_MATRIX §1.5), so we write through the
  // vector element directly.
  private indexOf(title: string): int32_t {
    for (let i: int32_t = 0; i < this.books.length; i = i + 1) {
      if (this.books[i]!.title === title) {
        return i;
      }
    }
    return -1;
  }

  // Lend a book out by title. Returns true on success, false if the title is
  // unknown or already on loan.
  checkOut(title: string): boolean {
    const i: int32_t = this.indexOf(title);
    if (i < 0) {
      return false;
    }
    if (this.books[i]!.status === Status.OnLoan) {
      return false;
    }
    this.books[i]!.status = Status.OnLoan;
    return true;
  }

  // Return a book by title. Returns true on success, false if the title is
  // unknown or was not on loan.
  returnBook(title: string): boolean {
    const i: int32_t = this.indexOf(title);
    if (i < 0) {
      return false;
    }
    if (this.books[i]!.status === Status.Available) {
      return false;
    }
    this.books[i]!.status = Status.Available;
    return true;
  }

  // How many books are currently available. A plain counting loop.
  availableCount(): int32_t {
    let n: int32_t = 0;
    for (const b of this.books) {
      if (b.status === Status.Available) {
        n = n + 1;
      }
    }
    return n;
  }

  // Total number of books on the shelf (any status). Uses .length on the
  // backing vector.
  totalCount(): int32_t {
    return this.books.length;
  }

  // Print every book, one per line. The free function statusLabel is called
  // from this class method body; struct fields b.id/b.title/b.status are
  // interpolated directly in the template literal.
  printAll(): void {
    for (const b of this.books) {
      console.log(`#${b.id} [${statusLabel(b.status)}] ${b.title}`);
    }
  }
}

// Entry point.
function main(): void {
  const lib: Library = new Library();

  // Stock a tiny everyday library.
  lib.add('The Pragmatic Programmer');
  lib.add('Clean Code');
  lib.add('The Mythical Man-Month');

  // Lend a couple of books out.
  const lent1: boolean = lib.checkOut('Clean Code');
  const lent2: boolean = lib.checkOut('The Pragmatic Programmer');
  // Trying to lend the same book twice is refused.
  const twice: boolean = lib.checkOut('Clean Code');
  // An unknown title is refused.
  const missing: boolean = lib.checkOut('Nonexistent');

  // Return one of them.
  const returned: boolean = lib.returnBook('Clean Code');
  // Returning a book that is not on loan is refused.
  const returnedAgain: boolean = lib.returnBook('Clean Code');

  // Report the outcomes.
  console.log(`lent1=${lent1}`);
  console.log(`lent2=${lent2}`);
  console.log(`double_lend_refused=${twice}`);
  console.log(`unknown_refused=${missing}`);
  console.log(`returned=${returned}`);
  console.log(`return_again_refused=${returnedAgain}`);
  console.log(`available=${lib.availableCount()}/${lib.totalCount()}`);
  console.log('---');
  lib.printAll();
  console.log('done');
}

main();

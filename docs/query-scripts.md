# Query scripts and automatic await

Query mode and Trusted Script mode both wait for Promise results automatically.
No preference or special execution mode is needed. Database work remains
asynchronous in the per-connection runtime; the application UI remains responsive.

```js
const users = db.collection("users");
const user = users.findOne({ name: "Ada" });
print(user?.name);

if (users.countDocuments({ active: true }) > 0) {
  print("Active users exist");
}
```

Assignments finish before the next statement starts. Results also resolve inside
arguments, conditions, operators, destructuring defaults, loops, and returns.
Ordinary helper functions, arrows, getters, and methods work the same way:

```js
function userName(id) {
  return users.findOne({ _id: id })?.name;
}
const names = ids.map(id => userName(id));
```

A helper with no asynchronous work on its executed path still returns a normal
synchronous value. Array `map`, `forEach`, `filter`, `reduce`, `find`, `some`,
`every`, and `flatMap` callbacks wait sequentially. These adaptations belong to
this script's VM; host application array prototypes and driver objects are not
modified.

## Parallel work

Use an explicit Promise combinator to start independent jobs together:

```js
const [active, archived] = Promise.all([
  users.countDocuments({ active: true }),
  users.countDocuments({ archived: true }),
]);
const records = Promise.all(ids.map(id => users.findOne({ _id: id })));
```

`Promise.allSettled`, `Promise.race`, and `Promise.any` also start their inputs
without serially waiting for them. Separate assignments remain sequential:

```js
const active = users.countDocuments({ active: true }); // finishes first
const archived = users.countDocuments({ archived: true });
```

Existing `async`, `await`, and `.then/.catch/.finally` scripts continue to work.
Uncaught failures stop subsequent statements. Rejections inside a `try` block
can be handled with ordinary `catch`; `finally` finishes before a function returns.

## Cursors and transactions

Iterate a cursor with `for...of`; MongoG uses its async iterator and closes it on
early exit. Returning a cursor still creates a paged result. Nothing calls
`toArray()` implicitly.

```js
for (const user of users.find({ active: true })) {
  users.updateOne({ _id: user._id }, { $set: { reviewed: true } });
}
users.find({ reviewed: true }); // paged result

const session = client.startSession();
try {
  session.withTransaction(() => {
    users.updateOne({ name: "Ada" }, { $set: { active: true } }, { session });
    users.updateOne({ name: "Grace" }, { $set: { active: true } }, { session });
  });
} finally {
  session.endSession();
}
```

Transactions require a MongoDB deployment that supports them and a callback
which returns a Promise (an awaited database operation in its execution path
provides one; an explicit `async` callback remains supported).

## Synchronous boundaries

Constructors, setters, synchronous generators, parameter defaults, class field
initializers, and `sort` comparators cannot suspend. A Promise result in these
contexts produces an explanatory error; obtain the value before entering the
context or move work to a normal helper. Purely synchronous comparators and
constructors continue to work.

Driver callbacks must actually consume their returned Promise. In particular,
`cursor.forEach` does not await an asynchronous callback. Use `for...of` for
callbacks that perform database work. This follows the distinction described in
[MongoDB shell scripting considerations](https://www.mongodb.com/docs/mongodb-shell/write-scripts/considerations/).

Cancellation is checked at automatic waits, calls and loop boundaries. User
`catch` blocks cannot swallow cancellation. Parallel operations stay registered
until their underlying promises settle, including losing `race` jobs and jobs
left by a rejected `all`. Cancellation acknowledgement does not claim that a
still-running driver operation has finished; the supervisor's hard-stop fallback
still applies to blocked operations and CPU-bound scripts.

The editor, saved scripts and history retain exactly the source you wrote. The
language worker uses a type-only virtual projection with source mappings, so
completions use resolved values and errors refer to the original code or selected
range. Formatting and code edits use the original source. Query policy and
read-only scans also inspect the original AST; automatic await is not a security
boundary or a replacement for MongoDB authorization.

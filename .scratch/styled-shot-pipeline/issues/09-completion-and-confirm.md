# 09: Completion and confirm

**What to build:** When every image in a batch has a yes or a no, the batch completes by
itself and a confirm control appears. Confirming freezes the batch and makes it the one the
web person will receive.

Completion and confirmation are different things and only one of them can be automated.
Completion is a computed fact — everything has been decided. Confirmation is a declared
intent — the reviewer is finished and wants it published. A machine can determine the first;
only a person can assert the second.

Because nothing downstream fires before confirmation, reversing a decision beforehand has no
consequences. That is what makes freezing afterwards acceptable.

**Blocked by:** 08

**Status:** done (2026-09-05)

- [x] A batch completes automatically when the count of approved plus the count of discarded equals its size
- [x] The confirm control is posted as a new message at the moment of completion, not carried in the message that opened the batch
- [x] The message that opens a batch still explains that confirmation will be needed
- [x] The confirm control states what it will do and that decisions cannot be changed afterwards, including the approved and discarded counts
- [x] Confirming marks the batch delivered and advances the delivered pointer to it
- [x] After confirmation, every further approve or discard on that batch is rejected
- [x] A batch that has never been confirmed never becomes the target of the pointer, regardless of its identifier

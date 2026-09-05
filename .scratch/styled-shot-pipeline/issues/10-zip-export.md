# 10: Zip export

**What to build:** The web person runs one command and receives a zip of the approved images,
each named for its SKU and shot idea. They stop asking Slack which files are final.

This is the whole delivery mechanism. Without it the system produces decisions and no
artefacts, and the half of the team's process where the damage actually occurs — the folder
with no naming convention, the wrong file that shipped for three weeks — is untouched.

**Blocked by:** 09

**Status:** done (2026-09-05)

- [x] A command returns the approved images of the latest delivered batch as a zip
- [x] Every file in the zip carries its deterministic name, identical to the name shown on its Slack message
- [x] The zip contains exactly the approved set — no discarded image is reachable through this or any other retrieval path
- [x] Retrieval reads through the delivered pointer, so a batch that is uploaded, generated, or fully reviewed but unconfirmed cannot be pulled
- [x] Running the command while a newer batch is mid-review returns the previous delivered batch, not the batch in progress
- [x] The file delivered is byte-identical to the file that was approved — same checksum as the stored object and the bytes shown in Slack
- [x] Anyone in the channel can run it without depending on the reviewer

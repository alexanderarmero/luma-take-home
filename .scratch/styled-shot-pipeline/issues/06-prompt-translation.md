# 06: Prompt translation

**What to build:** Shot Ideas stop going to the image model raw. Each becomes two to three
genuinely distinct generation prompts — different framing, different light, different degree
of styling — so the reviewer is choosing between real alternatives rather than three versions
of the same photograph.

Shot Ideas are written as what a person pictures, not as instructions to an image model. One of
them is a sentence ending in a question mark. Something has to bridge that.

The prompt that produced each image is shown on its message. The team's last tool failed for
lack of visibility, and showing the prompt is the fastest way for them to learn what a good
Shot Idea produces.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] A Shot Idea produces two to three prompts that differ meaningfully from one another while remaining faithful to it
- [ ] The stable system prefix carries the brand's own aesthetic, derived from the catalog's palette and materials rather than invented
- [ ] The team's existing Shot Ideas are included as tone calibration, so output matches their register rather than generic product-photography language
- [ ] The stable prefix is identical across every product in a batch and is cached, with cache hits verified rather than assumed
- [ ] The output shape is forced with structured outputs, not with assistant prefill
- [ ] The Notes column is not read, passed, or interpreted anywhere in prompt construction
- [ ] The prompt is displayed on each image message, rendered as a de-emphasised footnote rather than as content competing with the image
- [ ] The prompt used is stored against the image

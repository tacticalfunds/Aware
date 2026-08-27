/**
 * Image tools.
 *
 * Reverse image search has no free API worth using — Google Lens, Yandex, Bing
 * and TinEye all require either a paid contract or a browser session. So this
 * runs as a multi-engine handoff: the agent opens several engines at once, the
 * user pastes what each returned, and the agent cross-references them.
 *
 * Using several engines is not redundancy, it's the method. They index
 * differently and are good at different things, so agreement across two or more
 * is far stronger evidence than any single hit:
 *
 *   Yandex   consistently the best for places, faces and buildings
 *   Google   broadest general index, strong on products and landmarks
 *   Bing     different crawl to Google; sometimes the only one with a hit
 *   TinEye   exact/derivative matches with FIRST-SEEN dates — the one that
 *            establishes whether an image predates its claimed origin
 *   Baidu    Chinese-language web, invisible to the others
 *
 * Registered into the agent via IMAGE_TOOLS / IMAGE_EXECUTORS.
 */

const REVERSE_IMAGE_ENGINES = [
  { name: "Yandex Images", url: "https://yandex.com/images/",
    note: "Best for places, buildings and faces — usually try this one first." },
  { name: "Google Lens", url: "https://lens.google.com/",
    note: "Broadest index; strong on landmarks, products and text in the image." },
  { name: "Bing Visual Search", url: "https://www.bing.com/visualsearch",
    note: "Different crawl to Google — sometimes the only engine with a hit." },
  { name: "TinEye", url: "https://tineye.com/",
    note: "Sort by 'Oldest' — this is what dates an image and exposes reuse." },
  { name: "Baidu Image", url: "https://graph.baidu.com/",
    note: "Covers the Chinese-language web the others miss." }
];

const IMAGE_TOOLS = [
  {
    name: "reverse_image_search",
    description:
      "Runs a reverse image search across five engines at once (Yandex, Google Lens, Bing, TinEye, Baidu) as a user handoff — none of them have a usable free API, so the user uploads the image and pastes back what each returns. " +
      "This is the single most powerful technique for identifying an unknown image, and querying MULTIPLE engines is the point: they index differently, so a result appearing in two or more is far stronger than any single hit. " +
      "TinEye specifically gives first-seen dates, which is how you tell whether an image predates the story attached to it. " +
      "Use this early on any image whose origin or location is unknown. Afterwards, state which findings corroborate across engines and which appeared only once.",
    input_schema: {
      type: "object",
      properties: {
        image: {
          type: "number",
          description: "Which attached image to search with, 1-based, when several are attached. Run it separately per image — engines index them independently and one may hit where another does not."
        },
        looking_for: {
          type: "string",
          description: "What you want the user to look for and copy back, e.g. 'the top 5 result titles/URLs from each, plus TinEye's oldest date'."
        },
        engines: {
          type: "array",
          items: { type: "string" },
          description: "Optional subset by name. Defaults to all five."
        }
      }
    }
  }
];

const IMAGE_EXECUTORS = {
  async reverse_image_search(input, ctx) {
    if (!ctx.onManualRequest) {
      return "No interactive channel available, so the reverse image search can't be handed to the user.";
    }
    // With several images attached the user has to be told which one to upload.
    const which = Number.isFinite(input.image) ? Math.max(1, Math.round(input.image)) : null;
    const wanted = input.engines?.length
      ? REVERSE_IMAGE_ENGINES.filter(e =>
          input.engines.some(n => e.name.toLowerCase().includes(String(n).toLowerCase())))
      : REVERSE_IMAGE_ENGINES;
    const engines = wanted.length ? wanted : REVERSE_IMAGE_ENGINES;

    const reply = await ctx.onManualRequest({
      tool_name: "Reverse image search",
      links: engines,
      subject: which ? `Image ${which}` : null,
      what_to_copy: (which ? `Search with IMAGE ${which}. ` : "") + (input.looking_for ||
        "From each engine: the top few result titles and URLs, plus any place/landmark name it suggests. From TinEye, the oldest match date."),
      why: "Reverse image search across several engines — results that agree across two or more are much stronger evidence than a single hit.",
      multi: true
    });

    if (reply?.skipped) {
      return "The user skipped the reverse image search. Note it as unchecked — it's usually the highest-value step for an unidentified image, so say what it would have settled.";
    }
    return `Reverse image search results the user pasted back:\n\n${reply.text}\n\n` +
      `Now cross-reference: state which findings appear in two or more engines (strong), which appear only once (weak, worth a second check), ` +
      `and what any TinEye first-seen date implies about the image's age versus its claimed origin.`;
  }
};

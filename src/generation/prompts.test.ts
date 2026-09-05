import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCatalog } from "../catalog/parse.js";
import { addBatchRows, createBatch, getBatchRows } from "../db/repository.js";
import { createTestDb, type TestDb } from "../db/testing.js";
import { buildBrandContext, buildSystemPrompt } from "./brand.js";
import { createPromptWriter, fallbackPrompts } from "./prompts.js";
import { startGeneration } from "./start.js";

const REAL_CATALOG = readFileSync("data/catalog.csv", "utf8");

function realRows() {
  const parsed = parseCatalog(REAL_CATALOG);
  if (!parsed.ok) throw new Error("fixture should parse");
  return parsed.rows.map((r) => ({
    sku: r.sku,
    productName: r.productName,
    category: r.category,
    colour: r.colour,
    material: r.material,
    price: r.price,
    photoUrl: r.photoUrl,
    shotIdea: r.shotIdea,
  }));
}

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => {
  await db?.close();
});

describe("the brand, read from its own catalog", () => {
  it("finds the palette the products are actually made in", () => {
    const brand = buildBrandContext(realRows());
    expect(brand.palette).toContain("terracotta");
    expect(brand.palette).toContain("sage");
    expect(brand.palette).toContain("ochre");
  });

  it("splits a multi-word colour into its parts", () => {
    // "Sage Cream" and "Ochre Clay Terracotta" have no delimiter in the file.
    const brand = buildBrandContext(realRows());
    expect(brand.palette).toContain("cream");
    expect(brand.palette).toContain("clay");
  });

  it("finds the materials", () => {
    const brand = buildBrandContext(realRows());
    expect(brand.materials).toContain("stoneware");
    expect(brand.materials.join(" ")).toContain("linen");
  });

  it("takes the team's own shot ideas as tone examples", () => {
    const brand = buildBrandContext(realRows());
    expect(brand.toneExamples.length).toBeGreaterThan(0);
    expect(brand.toneExamples).toContain("morning kitchen counter, steam, warm light");
  });

  it("copes with a catalog nobody has written a shot idea for", () => {
    // The likely shape of next month's drop.
    const blank = realRows().map((r) => ({ ...r, shotIdea: null }));
    const brand = buildBrandContext(blank);
    expect(brand.toneExamples).toHaveLength(0);
    expect(brand.palette.length).toBeGreaterThan(0);
  });
});

describe("the system prompt", () => {
  it("carries the palette and materials", () => {
    const prompt = buildSystemPrompt(buildBrandContext(realRows()));
    expect(prompt).toContain("terracotta");
    expect(prompt).toContain("stoneware");
  });

  it("shows how this team writes, so the output matches their register", () => {
    const prompt = buildSystemPrompt(buildBrandContext(realRows()));
    expect(prompt).toContain("morning kitchen counter, steam, warm light");
  });

  it("asks for one restrained option, because 'too staged' is the usual rejection", () => {
    const prompt = buildSystemPrompt(buildBrandContext(realRows()));
    expect(prompt.toLowerCase()).toContain("restrained");
    expect(prompt.toLowerCase()).toContain("too staged");
  });

  it("forbids changing the product itself", () => {
    const prompt = buildSystemPrompt(buildBrandContext(realRows()));
    expect(prompt.toLowerCase()).toContain("never change its");
  });

  it("never mentions the Notes column", () => {
    const brand = buildBrandContext(realRows());
    const prompt = buildSystemPrompt(brand);
    expect(prompt).not.toContain("shoot with the mugs");
    expect(prompt).not.toContain("bestseller");
  });

  it("is identical for every product, which is what makes it cacheable", () => {
    const brand = buildBrandContext(realRows());
    expect(buildSystemPrompt(brand)).toBe(buildSystemPrompt(brand));
  });
});

describe("the prompt writer", () => {
  const writerWith = (parse: ReturnType<typeof vi.fn>) =>
    createPromptWriter({
      apiKey: "k",
      brand: buildBrandContext(realRows()),
      messages: { parse } as never,
    });

  const request = {
    shotIdea: "morning kitchen counter, steam, warm light",
    sku: "HG-002",
    productName: "Stoneware Mug 12oz",
    category: "Ceramics",
    colour: "Sage",
    material: "Stoneware",
    count: 3,
  };

  it("returns the prompts the model wrote", async () => {
    const parse = vi.fn().mockResolvedValue({
      parsed_output: { prompts: ["one", "two", "three"] },
    });
    expect(await writerWith(parse).write(request)).toEqual(["one", "two", "three"]);
  });

  it("marks the brand half of the request as cacheable", async () => {
    // Sixteen calls in quick succession over one unchanging prefix is exactly
    // what prompt caching is for.
    const parse = vi.fn().mockResolvedValue({ parsed_output: { prompts: ["a", "b", "c"] } });
    await writerWith(parse).write(request);

    const sent = parse.mock.calls[0]![0];
    expect(sent.system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("forces the shape with a schema rather than asking nicely", async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: { prompts: ["a", "b", "c"] } });
    await writerWith(parse).write(request);

    const sent = parse.mock.calls[0]![0];
    expect(sent.output_config.format.type).toBe("json_schema");
    expect(sent.model).toBe("claude-opus-5");
  });

  it("sends the product's own attributes, and nothing from Notes", async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: { prompts: ["a", "b", "c"] } });
    await writerWith(parse).write(request);

    const content = parse.mock.calls[0]![0].messages[0].content as string;
    expect(content).toContain("Stoneware Mug 12oz");
    expect(content).toContain("Sage");
    expect(content).toContain("morning kitchen counter");
  });

  it("pads a short answer rather than failing the product", async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: { prompts: ["only one"] } });
    expect(await writerWith(parse).write(request)).toHaveLength(3);
  });

  it("trims an over-long answer to the count asked for", async () => {
    const parse = vi.fn().mockResolvedValue({
      parsed_output: { prompts: ["a", "b", "c", "d", "e"] },
    });
    expect(await writerWith(parse).write(request)).toHaveLength(3);
  });

  it("throws when nothing usable comes back", async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: { prompts: ["", "  "] } });
    await expect(writerWith(parse).write(request)).rejects.toThrow();
  });
});

describe("translation failing", () => {
  async function batchOfOne() {
    const batch = await createBatch(db, { sourceFilename: "c.csv" });
    await addBatchRows(db, batch.id, [
      {
        sku: "HG-002",
        productName: "Mug",
        category: "Ceramics",
        colour: "Sage",
        material: "Stoneware",
        price: "$28",
        photoUrl: "https://example.com/a.jpg",
        shotIdea: "morning kitchen counter",
      },
    ]);
    return batch;
  }

  it("falls back to the shot idea unchanged, and the batch still runs", async () => {
    // A worse prompt is better than a batch that will not start.
    const batch = await batchOfOne();
    const result = await startGeneration(db, batch.id, {
      promptWriterFor: () => ({
        write: async () => {
          throw new Error("upstream down");
        },
      }),
    });

    expect(result.styled).toBe(3);
    expect(result.translated).toBe(0);

    const { rows } = await db.query<{ prompt: string }>(`select prompt from images`);
    expect(rows.every((r) => r.prompt === "morning kitchen counter")).toBe(true);
  });

  it("uses the written prompts when translation works", async () => {
    const batch = await batchOfOne();
    const result = await startGeneration(db, batch.id, {
      promptWriterFor: () => ({
        write: async () => ["wide and airy", "close and warm", "restrained"],
      }),
    });

    expect(result.translated).toBe(1);
    const { rows } = await db.query<{ prompt: string }>(
      `select prompt from images order by slot`,
    );
    expect(rows.map((r) => r.prompt)).toEqual([
      "wide and airy",
      "close and warm",
      "restrained",
    ]);
  });

  it("builds the brand from the batch's own rows", async () => {
    const batch = await createBatch(db, { sourceFilename: "c.csv" });
    await addBatchRows(db, batch.id, realRows());

    let seen: string[] = [];
    await startGeneration(db, batch.id, {
      promptWriterFor: (brand) => {
        seen = brand.palette;
        return { write: async () => ["a", "b", "c"] };
      },
    });

    expect(seen).toContain("terracotta");
    expect((await getBatchRows(db, batch.id)).length).toBe(40);
  });

  it("works with no writer at all", async () => {
    const batch = await batchOfOne();
    const result = await startGeneration(db, batch.id);
    expect(result.styled).toBe(3);
    expect(result.translated).toBe(0);
  });
});

describe("fallbackPrompts", () => {
  it("repeats the shot idea for each candidate", () => {
    expect(fallbackPrompts("holiday mantel", 3)).toEqual([
      "holiday mantel",
      "holiday mantel",
      "holiday mantel",
    ]);
  });
});

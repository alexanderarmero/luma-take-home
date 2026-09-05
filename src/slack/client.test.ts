import { describe, expect, it, vi } from "vitest";
import { createSlackClient } from "./client.js";

type FetchArgs = [string, RequestInit];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clientWith(fetchImpl: typeof fetch) {
  return createSlackClient({ botToken: "xoxb-test", fetch: fetchImpl });
}

describe("postMessage", () => {
  it("posts to the channel and returns the message timestamp", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: true, ts: "1700000000.000100" }),
    ) as unknown as typeof fetch;

    const result = await clientWith(fetchImpl).postMessage({
      channel: "C123",
      text: "hello",
    });

    expect(result.ts).toBe("1700000000.000100");
    const [url, init] = (fetchImpl as unknown as { mock: { calls: FetchArgs[] } })
      .mock.calls[0]!;
    expect(url).toBe("https://slack.com/api/chat.postMessage");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer xoxb-test",
    );
    expect(JSON.parse(init.body as string)).toMatchObject({
      channel: "C123",
      text: "hello",
    });
  });

  it("treats an ok:false body as a failure even though the status is 200", async () => {
    // Slack answers API errors with HTTP 200 and ok:false. Checking only the
    // status code means every failure looks like a success.
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: false, error: "not_in_channel" }),
    ) as unknown as typeof fetch;

    await expect(
      clientWith(fetchImpl).postMessage({ channel: "C123", text: "hi" }),
    ).rejects.toThrow(/not_in_channel/);
  });

  it("surfaces a transport-level failure with the status", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: "server_error" }, 503),
    ) as unknown as typeof fetch;

    await expect(
      clientWith(fetchImpl).postMessage({ channel: "C123", text: "hi" }),
    ).rejects.toThrow(/503/);
  });
});

describe("updateMessage", () => {
  it("edits a message in place", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: true, ts: "1700000000.000100" }),
    ) as unknown as typeof fetch;

    await clientWith(fetchImpl).updateMessage({
      channel: "C123",
      ts: "1700000000.000100",
      text: "decided",
    });

    const [url, init] = (fetchImpl as unknown as { mock: { calls: FetchArgs[] } })
      .mock.calls[0]!;
    expect(url).toBe("https://slack.com/api/chat.update");
    expect(JSON.parse(init.body as string)).toMatchObject({
      channel: "C123",
      ts: "1700000000.000100",
    });
  });
});

describe("uploadImage", () => {
  it("walks the three-call upload flow in order", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("getUploadURLExternal")) {
        return jsonResponse({
          ok: true,
          upload_url: "https://files.slack.com/upload/abc",
          file_id: "F123",
        });
      }
      if (url.includes("files.slack.com/upload")) {
        return new Response("OK - 12", { status: 200 });
      }
      return jsonResponse({ ok: true, files: [{ id: "F123" }] });
    }) as unknown as typeof fetch;

    const result = await clientWith(fetchImpl).uploadImage({
      channel: "C123",
      filename: "HG-002_morning-kitchen_01.jpg",
      title: "HG-002_morning-kitchen_01.jpg",
      bytes: Buffer.from("not-really-a-jpeg"),
    });

    expect(result.fileId).toBe("F123");
    expect(calls).toEqual([
      "https://slack.com/api/files.getUploadURLExternal",
      "https://files.slack.com/upload/abc",
      "https://slack.com/api/files.completeUploadExternal",
    ]);
  });

  it("sends the byte length Slack asks for up front", async () => {
    const bytes = Buffer.from("twelve bytes");
    let requestedLength: string | null = null;

    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("getUploadURLExternal")) {
        requestedLength = new URLSearchParams(init!.body as string).get("length");
        return jsonResponse({ ok: true, upload_url: "https://x/u", file_id: "F1" });
      }
      if (url === "https://x/u") return new Response("OK", { status: 200 });
      return jsonResponse({ ok: true, files: [{ id: "F1" }] });
    }) as unknown as typeof fetch;

    await clientWith(fetchImpl).uploadImage({
      channel: "C1",
      filename: "a.jpg",
      title: "a.jpg",
      bytes,
    });

    expect(requestedLength).toBe(String(bytes.byteLength));
  });

  it("passes blocks and never an initial comment", async () => {
    // Slack ignores `blocks` outright when `initial_comment` is present, so
    // sending both would silently drop the buttons.
    let completeBody: URLSearchParams | null = null;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("getUploadURLExternal")) {
        return jsonResponse({ ok: true, upload_url: "https://x/u", file_id: "F1" });
      }
      if (url === "https://x/u") return new Response("OK", { status: 200 });
      completeBody = new URLSearchParams(init!.body as string);
      return jsonResponse({ ok: true, files: [{ id: "F1" }] });
    }) as unknown as typeof fetch;

    await clientWith(fetchImpl).uploadImage({
      channel: "C1",
      filename: "a.jpg",
      title: "a.jpg",
      bytes: Buffer.from("x"),
      blocks: [{ type: "actions", elements: [] }],
    });

    expect(completeBody!.get("blocks")).toContain("actions");
    expect(completeBody!.get("initial_comment")).toBeNull();
  });

  it("fails loudly if the byte upload is rejected", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("getUploadURLExternal")) {
        return jsonResponse({ ok: true, upload_url: "https://x/u", file_id: "F1" });
      }
      return new Response("nope", { status: 500 });
    }) as unknown as typeof fetch;

    await expect(
      clientWith(fetchImpl).uploadImage({
        channel: "C1",
        filename: "a.jpg",
        title: "a.jpg",
        bytes: Buffer.from("x"),
      }),
    ).rejects.toThrow(/500/);
  });
});

describe("openView", () => {
  it("opens a modal against the trigger id", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: true, view: { id: "V1" } }),
    ) as unknown as typeof fetch;

    await clientWith(fetchImpl).openView({
      triggerId: "trigger-123",
      view: { type: "modal", callback_id: "catalog_upload" },
    });

    const [url, init] = (fetchImpl as unknown as { mock: { calls: FetchArgs[] } })
      .mock.calls[0]!;
    expect(url).toBe("https://slack.com/api/views.open");
    expect(JSON.parse(init.body as string)).toMatchObject({
      trigger_id: "trigger-123",
      view: { callback_id: "catalog_upload" },
    });
  });

  it("reports an expired trigger clearly", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: false, error: "expired_trigger_id" }),
    ) as unknown as typeof fetch;

    await expect(
      clientWith(fetchImpl).openView({ triggerId: "old", view: {} }),
    ).rejects.toThrow(/expired_trigger_id/);
  });
});

describe("downloadFile", () => {
  it("sends the bot token, because private files are not public", async () => {
    let sentAuth: string | undefined;
    const fetchImpl = vi.fn(async (_input: unknown, init?: RequestInit) => {
      sentAuth = (init?.headers as Record<string, string>)?.Authorization;
      return new Response("SKU,Product Name\nHG-001,Vase", {
        status: 200,
        headers: { "content-type": "text/csv" },
      });
    }) as unknown as typeof fetch;

    const text = await clientWith(fetchImpl).downloadFile(
      "https://files.slack.com/files-pri/T1-F1/catalog.csv",
    );

    expect(sentAuth).toBe("Bearer xoxb-test");
    expect(text).toContain("HG-001");
  });

  it("refuses an HTML sign-in page instead of parsing it as a catalog", async () => {
    // Slack answers an unauthenticated request for a private file with a 200
    // and a sign-in page. Without this check the failure surfaces much later
    // as a baffling "missing required columns" error naming HTML as the header.
    const fetchImpl = vi.fn(async () =>
      new Response("<!DOCTYPE html><html><body>Sign in to Slack</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ) as unknown as typeof fetch;

    await expect(
      clientWith(fetchImpl).downloadFile("https://files.slack.com/files-pri/x"),
    ).rejects.toThrow(/could not be downloaded/i);
  });

  it("surfaces a non-200 download", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("nope", { status: 404 }),
    ) as unknown as typeof fetch;

    await expect(
      clientWith(fetchImpl).downloadFile("https://files.slack.com/files-pri/x"),
    ).rejects.toThrow(/404/);
  });
});

describe("error reporting", () => {
  it("includes the field-level detail Slack sends with invalid_blocks", async () => {
    // The bare code says a message was rejected but not which block or field.
    // Discarding the detail turns a one-line fix into guesswork.
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        ok: false,
        error: "invalid_blocks",
        response_metadata: {
          messages: ["[ERROR] missing required field: alt_text [json-pointer:/blocks/1]"],
        },
      }),
    ) as unknown as typeof fetch;

    await expect(
      clientWith(fetchImpl).postMessage({ channel: "C1", text: "hi" }),
    ).rejects.toThrow(/alt_text.*json-pointer/);
  });

  it("includes an errors array when Slack sends one", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        ok: false,
        error: "invalid_blocks",
        errors: ["invalid_blocks_format"],
      }),
    ) as unknown as typeof fetch;

    await expect(
      clientWith(fetchImpl).postMessage({ channel: "C1", text: "hi" }),
    ).rejects.toThrow(/invalid_blocks_format/);
  });

  it("still reports the bare code when there is no detail", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: false, error: "channel_not_found" }),
    ) as unknown as typeof fetch;

    await expect(
      clientWith(fetchImpl).postMessage({ channel: "C1", text: "hi" }),
    ).rejects.toThrow(/channel_not_found/);
  });
});

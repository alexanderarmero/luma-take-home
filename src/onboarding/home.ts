import type { Block } from "../slack/client.js";

/**
 * The app's Home tab: what this is, and what to do first.
 *
 * Slack publishes this to each person the first time they open the app, which
 * makes it the one place a newcomer reliably looks before asking anyone. It is
 * written for somebody who has just been added to the workspace and has never
 * seen a shot idea — hence the CSV column list and the note about muting,
 * neither of which are obvious and both of which cause problems when missed.
 */
export function buildHomeView(
  options: { reviewChannelId?: string } = {},
): Record<string, unknown> {
  const channel = options.reviewChannelId
    ? `<#${options.reviewChannelId}>`
    : "your review channel";

  const blocks: Block[] = [
    { type: "header", text: { type: "plain_text", text: "Luma Shots", emoji: true } },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*Turns the Shot Idea column of your catalog into styled product " +
          "photographs — reviewed and signed off here, without leaving Slack.*\n\n" +
          "You upload a CSV. It writes prompts, generates three options per " +
          "product, and posts them for review. You approve the ones you want. " +
          "When everything is decided you get a zip with sensible filenames.",
      },
    },
    { type: "divider" },

    { type: "header", text: { type: "plain_text", text: "1 · Set up the channel", emoji: true } },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `Everything is posted to one channel — ${channel}. Invite the app to ` +
          "it with `/invite @Luma Shots` if it is not there already.\n\n" +
          "*Mute that channel.* A batch of 40 products posts 40 messages, and " +
          "you do not want 40 notifications. You will still be @-mentioned " +
          "*once*, when the whole batch is ready for you — that single ping is " +
          "the design, and muting is what makes it work.\n\n" +
          "_In Slack: click the channel name → *Notifications* → *Mute channel*._",
      },
    },
    { type: "divider" },

    {
      type: "header",
      text: { type: "plain_text", text: "2 · Get the ability to decide", emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "Run `/luma signin`. It sends you a private link that lasts a day.\n\n" +
          "*Anyone can open the overview page and look* — approving and " +
          "discarding are what need the sign-in. Do it before a batch finishes " +
          "and it will be ready when the photographs are.\n\n" +
          "Whoever set the app up controls who can decide, with `/luma access`.",
      },
    },
    { type: "divider" },

    {
      type: "header",
      text: { type: "plain_text", text: "3 · Build your catalog CSV", emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "Export your catalog as a CSV with these columns. The names must " +
          "match:\n\n```\nSKU, Product Name, Category, Color / Finish, Material, " +
          "Price, Photo, Shot Idea, Notes\n```",
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*The two that do the work:*\n\n" +
          "• *Photo* — a public link to the product's existing photograph, " +
          "usually the plain white-background one. Every styled shot is made " +
          "*from* this picture, so the product keeps its real shape and colour. " +
          "The link has to be reachable without a login.\n\n" +
          "• *Shot Idea* — a short phrase describing the scene you want. " +
          "`morning kitchen counter`. `draped over a reading chair`. " +
          "`bathroom shelf, soft light`. Write it the way you would say it to a " +
          "photographer; you do not need to write a prompt.",
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*Two rules worth knowing before you fill it in:*\n\n" +
          "• *Leave Shot Idea blank and nothing is invented.* That product's " +
          "existing photograph is passed through unchanged, and it costs " +
          "nothing. Use this for anything you are happy with already.\n\n" +
          "• *Notes are ignored, on purpose.* They mix reminders, scheduling and " +
          "real instructions, and feeding them to an image model corrupts about " +
          "twice as many shots as it improves — a note reading _\"shoot with the " +
          "mugs maybe\"_ on a blanket will put mugs in the blanket photograph. " +
          "*If it needs to be in the shot, put it in Shot Idea.*",
      },
    },
    { type: "divider" },

    {
      type: "header",
      text: { type: "plain_text", text: "4 · Upload, and see the bill first", emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "Run `/luma upload` and drop the CSV in.\n\n" +
          "It reads the file and shows you exactly what it would make and what " +
          "it would cost — *before anything is generated and before anything is " +
          "charged.* If a row is unusable it says which row and why, and the " +
          "rest of the file is unaffected.\n\n" +
          "*Generate* is the button on that same window. Nothing is spent until " +
          "you press it. A 40-product catalog costs a few dollars and takes a " +
          "few minutes.",
      },
    },
    { type: "divider" },

    {
      type: "header",
      text: { type: "plain_text", text: "5 · Review the photographs", emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "Photographs arrive product by product, not one at a time. Each " +
          "product gets *one line in the channel* and its three options in " +
          "*that line's thread* — so comments about a shot stay under the shot.\n\n" +
          "*Deciding happens on the overview page*, linked from every product " +
          "line and from the batch's pinned opening message. The page shows a " +
          "product's three options side by side, because choosing between them " +
          "is a comparison, not a verdict. Filter it by what still needs you.\n\n" +
          "• *Approve* or *Discard* each photograph.\n" +
          "• *Ask for another* if none are right — you write the prompt, it " +
          "makes one more, and nothing already there is replaced.\n" +
          "• If a photograph never arrived, *Try again* re-runs it, or " +
          "*Discard* settles it.",
      },
    },
    { type: "divider" },

    {
      type: "header",
      text: { type: "plain_text", text: "6 · Confirm, and collect the files", emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "Once every photograph has a yes or a no, a *Confirm* panel appears on " +
          "the page. It takes two taps, because it cannot be undone.\n\n" +
          "Confirming freezes the batch and posts a message to the channel with " +
          "*the zip attached* — every file named for its product and shot idea, " +
          "like `HG-002_morning-kitchen_01.jpg`, plus a CSV of what was " +
          "approved. Nobody has to ask which files are final.\n\n" +
          "A confirmed batch never changes. Corrections are a new batch, which " +
          "is what makes _\"what did we deliver?\"_ have one answer.",
      },
    },
    { type: "divider" },

    { type: "header", text: { type: "plain_text", text: "Commands", emoji: true } },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "• `/luma upload` — read a catalog CSV and price the batch\n" +
          "• `/luma status` — where the latest batch stands\n" +
          "• `/luma signin` — get the link that lets you decide\n" +
          "• `/luma generate` — try an idea on one photo, privately\n" +
          "• `/luma system-prompt` — see and change how shot ideas become prompts\n" +
          "• `/luma access` — who can decide _(app owner only)_\n" +
          "• `/luma help` — this list, in the channel\n\n" +
          "_Each also works as its own command, so Slack can suggest it as you " +
          "type: `/luma-upload` is the same as `/luma upload`._",
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text:
            "Nothing here is published to your website automatically — the zip " +
            "is the handoff, and the last step stays with a person.",
        },
      ],
    },
  ];

  return { type: "home", blocks };
}

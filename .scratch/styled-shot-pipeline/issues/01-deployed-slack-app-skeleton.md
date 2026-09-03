# 01: Deployed Slack app skeleton

**What to build:** A Slack workspace with a dedicated review channel and an installed app,
backed by a service running on a real host. Typing a ping slash command in the channel gets a
reply from the deployed service. Nothing else works yet — but deployment, request
authenticity, and the Slack round trip are proven.

Deployment is a hard requirement of this project and deploy problems discovered late are the
usual way a short build fails. This ticket exists to retire that risk on day one rather than
at the end.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A Slack workspace exists with a dedicated review channel, top-level posting restricted and thread replies open
- [ ] A Slack app is installed with the scopes needed to post messages, upload files, and receive interactions
- [ ] The service is deployed to a real host and reachable over HTTPS
- [ ] Inbound Slack requests are verified for authenticity, and requests failing verification are rejected
- [ ] Every inbound Slack request is acknowledged within Slack's three-second window, with any real work deferred
- [ ] A ping slash command typed in the channel returns a reply from the deployed service
- [ ] Secrets are supplied by environment and no credential is committed

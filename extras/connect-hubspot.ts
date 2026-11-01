// OPTIONAL (off by default). To enable Vercel Connect:
//   1. npm install @vercel/connect
//   2. vercel connect create hubspot --name campaign-studio
//      vercel connect attach <connector-uid> --yes
//   3. Copy this file to agent/connections/hubspot.ts and put the UID below.
// The agent can then push the approved kit to HubSpot as drafts. Vercel Connect
// issues short-lived, scoped tokens at runtime; nothing long-lived is stored in the app.
import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";
import { always } from "eve/tools/approval";

export default defineMcpClientConnection({
  url: "https://mcp.hubspot.com/anthropic",
  description: "HubSpot marketing workspace. Use only to save approved campaign assets as drafts.",
  // App-scoped: the agent is called by this app's server, not by an end user.
  auth: connect({ connector: "<connector-uid>", principalType: "app" }),
  approval: always(), // a person approves every write
});

import { localDev, vercelOidc } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

// Browsers never call the agent directly. Only this project's own server code
// (signed with its Vercel OIDC token) and local development are accepted.
export default eveChannel({
  auth: [vercelOidc(), localDev()],
});

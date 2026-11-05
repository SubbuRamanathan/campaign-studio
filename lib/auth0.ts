import { Auth0Client } from "@auth0/nextjs-auth0/server";

// Sitecore custom authorization: the author signs in once with Sitecore's Auth0, and the server
// then calls SitecoreAI APIs as that user. Reads AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET,
// AUTH0_SECRET and APP_BASE_URL from the environment.
export const auth0 = new Auth0Client({
  authorizationParameters: { audience: "https://api.sitecorecloud.io", scope: "openid profile email offline_access" },
  // The panel runs in an iframe on another site, so the session cookie must be sent cross-site.
  session: { cookie: { sameSite: "none", secure: true } },
});

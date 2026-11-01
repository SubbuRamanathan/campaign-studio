"use client";

import { ClientSDK, type ApplicationContext } from "@sitecore-marketplace-sdk/client";
import { XMC } from "@sitecore-marketplace-sdk/xmc";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type State = { client: ClientSDK | null; appContext: ApplicationContext | null; error: Error | null };
const MarketplaceContext = createContext<State>({ client: null, appContext: null, error: null });

// Sitecore best practice: initialize the SDK once, centrally, and share it.
let sdk: Promise<ClientSDK> | null = null;

export function MarketplaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ client: null, appContext: null, error: null });

  useEffect(() => {
    sdk ??= ClientSDK.init({ target: window.parent, modules: [XMC] });
    sdk
      .then(async (client) => {
        const { data } = await client.query("application.context");
        setState({ client, appContext: data ?? null, error: null });
      })
      .catch((error: Error) => setState((s) => ({ ...s, error })));
  }, []);

  return <MarketplaceContext.Provider value={state}>{children}</MarketplaceContext.Provider>;
}

export const useMarketplaceClient = () => {
  const { client, error } = useContext(MarketplaceContext);
  return { client, error };
};
export const useAppContext = () => useContext(MarketplaceContext).appContext;

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_MOCK_API?: string;
  readonly VITE_OFFSET_ROUTER?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
  readonly VITE_SEPOLIA_RPC_URL?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_PROJECT_REGISTRY?: string;
  readonly VITE_CARBON_CREDIT?: string;
  readonly VITE_MARKETPLACE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

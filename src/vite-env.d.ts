/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SIM_WASM_URL?: string
}

interface Window {
  __SIM_WASM_URL__?: string
}

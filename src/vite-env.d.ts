/// <reference types="vite/client" />

declare const __APP_VERSION__: string

declare module 'https://*' {
  const content: any
  export default content
}

interface Window {
  mermaid?: any
}

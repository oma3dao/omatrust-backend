export const omachainTestnet = {
  key: "omachain-testnet",
  id: 66238,
  chainId: 66238,
  rpc: "https://rpc.testnet.chain.oma3.org/",
  name: "OMAchain Testnet",
  testnet: true,
  explorerUrl: "https://explorer.testnet.chain.oma3.org/",
  contracts: {
    easContract: "0x8835AF90f1537777F52E482C8630cE4e947eCa32"
  }
} as const;

export const omachainMainnet = {
  key: "omachain-mainnet",
  id: 6623,
  chainId: 6623,
  rpc: "https://rpc.chain.oma3.org/",
  name: "OMAchain Mainnet",
  testnet: false,
  explorerUrl: "https://explorer.chain.oma3.org/",
  contracts: {
    easContract: "0x0000000000000000000000000000000000000000"
  }
} as const;

export const omachainDevnet = {
  key: "omachain-devnet",
  id: 66239,
  chainId: 66239,
  rpc: "https://rpc.devnet.chain.oma3.org/",
  name: "OMAchain DevNet",
  testnet: true,
  explorerUrl: "https://explorer.devnet.chain.oma3.org/",
  contracts: {
    easContract: "0x0000000000000000000000000000000000000000"
  }
} as const;

export const CHAIN_PRESETS = {
  "omachain-testnet": omachainTestnet,
  "omachain-mainnet": omachainMainnet,
  "omachain-devnet": omachainDevnet
} as const;

export const CHAIN_PRESET_KEYS = Object.keys(CHAIN_PRESETS) as Array<keyof typeof CHAIN_PRESETS>;

export type ChainPreset = keyof typeof CHAIN_PRESETS;
export type ActiveChainConfig = (typeof CHAIN_PRESETS)[ChainPreset];

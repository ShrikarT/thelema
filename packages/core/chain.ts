/**
 * Single source of truth for Arc network configuration.
 * Consumed across contracts deploy script, arc client, web wallet, and core market.
 *
 * Arc Mainnet (Chain ID 5042):
 *   - Native USDC Precompile: 0x3600000000000000000000000000000000000000
 *   - Default RPC: https://rpc.arc.io
 *   - Explorer: https://arcscan.app
 *
 * Arc Testnet (Chain ID 5042002):
 *   - Native USDC Precompile: 0x3600000000000000000000000000000000000000
 *   - Default RPC: https://rpc.testnet.arc.io
 *   - Explorer: https://testnet.arcscan.app
 */

export interface ArcChainConfig {
  chainId: number;
  chainName: string;
  collateral: string;
  rpcUrl: string;
  explorer: string;
  isTestnet: boolean;
}

export const PRECOMPILE_USDC = '0x3600000000000000000000000000000000000000';

export const ARC_CHAINS: Record<number, ArcChainConfig> = Object.freeze({
  5042: Object.freeze({
    chainId: 5042,
    chainName: 'Arc Mainnet',
    collateral: (typeof process !== 'undefined' && process.env?.ARC_USDC) || PRECOMPILE_USDC,
    rpcUrl: (typeof process !== 'undefined' && process.env?.ARC_MAINNET_RPC_URL) || 'https://rpc.mainnet.arc.io',
    explorer: 'https://arcscan.app',
    isTestnet: false
  }),
  5042002: Object.freeze({
    chainId: 5042002,
    chainName: 'Arc Testnet',
    collateral: (typeof process !== 'undefined' && process.env?.ARC_USDC) || PRECOMPILE_USDC,
    rpcUrl: (typeof process !== 'undefined' && process.env?.ARC_TESTNET_RPC_URL) || 'https://rpc.testnet.arc.io',
    explorer: 'https://testnet.arcscan.app',
    isTestnet: true
  })
});

export const DEFAULT_CHAIN_ID = 5042002;

export function getChainConfig(chainId: number = DEFAULT_CHAIN_ID): ArcChainConfig {
  const cfg = ARC_CHAINS[chainId];
  if (!cfg) {
    throw new Error(`Unsupported chain ID ${chainId}. Supported chains: ${Object.keys(ARC_CHAINS).join(', ')}`);
  }
  return cfg;
}

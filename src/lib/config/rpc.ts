import { JsonRpcProvider } from "ethers";
import { getActiveChain, getEnv } from "@/lib/config/env";

export function getPublicRpcProvider() {
  return new JsonRpcProvider(getActiveChain().rpc);
}

export function getPremiumRpcProvider() {
  return new JsonRpcProvider(getEnv().OMATRUST_PREMIUM_RPC_URL);
}

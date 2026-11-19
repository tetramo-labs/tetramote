import {remote} from "@tetratop/remote"
import * as SecureStore from "expo-secure-store"

const KEY = "tetratop.secretKey"
const HEX_KEY = /^[0-9a-f]{64}$/

/** The phone's iroh identity. The Mac trusts the endpoint id derived from it. */
export async function loadSecretKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY)
  if (existing && HEX_KEY.test(existing)) return existing
  const created = remote.generateSecretKey()
  await SecureStore.setItemAsync(KEY, created, {keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY})
  return created
}

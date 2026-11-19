import {createMMKV, type MMKV} from "react-native-mmkv"
import {result as Res, type Result} from "typesafe-ts"

let mmkv: MMKV | null = null

function store(): MMKV {
  mmkv ??= createMMKV({id: "tetratop"})
  return mmkv
}

export function load<T>(key: string): Result<T, Error> {
  return Res.try(() => {
    const raw = store().getString(key)
    if (raw === undefined) throw new Error(`nothing stored under ${key}`)
    return JSON.parse(raw) as T
  })
}

export function save(key: string, value: unknown): Result<void, Error> {
  return Res.try(() => {
    store().set(key, JSON.stringify(value))
  })
}

export function remove(key: string): void {
  store().remove(key)
}
